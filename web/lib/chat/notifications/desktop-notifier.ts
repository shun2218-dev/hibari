import type { NotificationContent } from "./desktop-notification";

/**
 * ブラウザ通知を出す係（ADR 0057 決定 2・4・6）。「出すか」の規則は desktop-notification.ts が決め、ここは「どのタブが・いつ出すか」だけを持つ。
 *
 * - Web Locks の `hibari:notifier` を持ったタブだけが出す。ロックを持つタブが閉じられると、待っていたタブが引き継ぐ（ADR 0024 と同じ仕組み）
 * - どのタブも見えていないときだけ出す。タブの見え方は BroadcastChannel で知らせ合う
 * - Web Locks がない環境では、そのタブが見えていないときにそのタブが出す（重複は tag で OS が置き換える）
 *
 * ブラウザの API はすべて外から渡す（テストで偽物に替えるため）。
 */

export type NotifierChannel = {
  postMessage(message: VisibilityMessage): void;
  addEventListener(type: "message", listener: (event: { data: VisibilityMessage }) => void): void;
  close(): void;
};

export type VisibilityMessage =
  | { type: "hello"; tab: string; visible: boolean }
  | { type: "visibility"; tab: string; visible: boolean }
  | { type: "bye"; tab: string };

export type DesktopNotifierOptions = {
  /** このタブの識別子（BroadcastChannel で自分の知らせを見分ける）。 */
  tabId: string;
  /** 通知の許可（`Notification.permission`）。unsupported は API のない環境。 */
  permission: () => NotificationPermission | "unsupported";
  /** 通知を出す。押されたら onClick を呼ぶ。 */
  show: (content: NotificationContent, onClick: () => void) => void;
  /** Web Locks。ない環境では undefined。 */
  locks?: { request(name: string, callback: () => Promise<void>): Promise<unknown> };
  /**
   * タブをまたぐ知らせを作る。ない環境では undefined（このタブの見え方だけで決める）。
   * start のたびに作り、stop で閉じる（React の Strict Mode は start → stop → start と呼ぶので、閉じたものを使い回さない）。
   */
  createChannel?: () => NotifierChannel;
  /** このタブが見えているか。 */
  visible: () => boolean;
  /** このタブの見え方が変わったら呼ぶ関数を登録し、解除する関数を返す。 */
  onVisibilityChange: (listener: () => void) => () => void;
  /** 通知音（ADR 0057 決定 6）。鳴らせないときは黙って何もしない。 */
  playSound: () => void;
  soundEnabled: () => boolean;
  /** 押したときに、このタブを前に出して開く。 */
  open: (url: string) => void;
};

export type DesktopNotifier = {
  start(): void;
  stop(): void;
  /** 通知係のタブで、どのタブも見えていなければ通知を出す。出したら true。 */
  notify(content: NotificationContent): boolean;
};

export function createDesktopNotifier(options: DesktopNotifierOptions): DesktopNotifier {
  const { tabId, createChannel, locks } = options;
  let channel: NotifierChannel | undefined;
  // ほかのタブの見え方。閉じたタブは bye で消える
  const others = new Map<string, boolean>();
  let leader = locks === undefined;
  let releaseLock: (() => void) | undefined;
  let unsubscribeVisibility: (() => void) | undefined;
  let running = false;

  function anyVisible(): boolean {
    if (options.visible()) return true;
    for (const visible of others.values()) if (visible) return true;
    return false;
  }

  function onMessage({ data }: { data: VisibilityMessage }) {
    if (data.tab === tabId) return;
    if (data.type === "bye") {
      others.delete(data.tab);
      return;
    }
    others.set(data.tab, data.visible);
    // 新しく開いたタブに、こちらの見え方を返す
    if (data.type === "hello") channel?.postMessage({ type: "visibility", tab: tabId, visible: options.visible() });
  }

  return {
    start() {
      if (running) return;
      running = true;
      others.clear();
      channel = createChannel?.();
      channel?.addEventListener("message", onMessage);
      channel?.postMessage({ type: "hello", tab: tabId, visible: options.visible() });
      unsubscribeVisibility = options.onVisibilityChange(() => {
        channel?.postMessage({ type: "visibility", tab: tabId, visible: options.visible() });
      });
      // ロックはこのタブが閉じられるか stop するまで持ち続ける。取れるまで待つ（ほかのタブが持っている間）
      void locks
        ?.request("hibari:notifier", () => {
          if (!running) return Promise.resolve();
          leader = true;
          return new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
        })
        .catch(() => {
          // ロックを取れなかった（中断など）。このタブは通知を出さない
        });
    },

    stop() {
      running = false;
      leader = locks === undefined;
      releaseLock?.();
      releaseLock = undefined;
      unsubscribeVisibility?.();
      channel?.postMessage({ type: "bye", tab: tabId });
      channel?.close();
      channel = undefined;
    },

    notify(content) {
      if (!running || !leader || options.permission() !== "granted" || anyVisible()) return false;
      options.show(content, () => options.open(content.url));
      if (options.soundEnabled()) options.playSound();
      return true;
    },
  };
}

/**
 * 短い通知音を Web Audio で合成して鳴らす（ADR 0057 決定 6。音の素材を持ち込まない）。
 * 自動再生の制限で AudioContext が止まっているとき（このタブで一度も操作していない）は、黙って何もしない。
 */
export function createChime(): { play(): void; unlock(): void } {
  let context: AudioContext | undefined;
  function ensure(): AudioContext | undefined {
    if (context) return context;
    const Ctor = typeof window === "undefined" ? undefined : window.AudioContext;
    if (!Ctor) return undefined;
    context = new Ctor();
    return context;
  }
  return {
    // 操作をきっかけに作っておくと、あとで操作なしに鳴らせる
    unlock() {
      void ensure()?.resume().catch(() => {});
    },
    play() {
      const ctx = ensure();
      if (!ctx || ctx.state !== "running") return;
      const now = ctx.currentTime;
      // 2 つの音を少しずらして重ねる（高い方が後）。音量はすぐに絞って、耳に残らない長さにする
      for (const [frequency, offset] of [
        [880, 0],
        [1320, 0.09],
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.3);
      }
    },
  };
}
