import type { PushSubscriptionRequest } from "@/lib/api/types.gen";
import type { PushApi } from "@/lib/chat/api/push";

/**
 * このブラウザのプッシュ通知（ADR 0069）。Service Worker の登録・購読・サーバーへの登録と、その状態を持つ。
 *
 * 通知を出すのは Service Worker（`public/sw.js`）で、ここはページの側の仕事だけ:
 * - 購読を作って `PUT /api/v1/me/push-subscription` する（スイッチや帯を押したとき）
 * - ページを開くたびに、いまの購読を PUT し直す（決定 4。ブラウザが endpoint を変えても、SW はトークンを持たず API を呼べない）
 * - 「このブラウザでプッシュが有効か」をタブの通知（desktop-notifier.ts）に教える（決定 2。二重に出さない）
 *
 * 画面（設定の「通知」・サイドバーの帯。SHU-28 / SHU-29）は state / enable / disable / listDevices / stopDevice を呼ぶ。
 * ブラウザの API はすべて外から渡す（テストで偽物に替えるため）。
 */

/** Service Worker のパス。スコープを `/` にするため、サイトの直下に置く（`public/sw.js`）。 */
export const SERVICE_WORKER_URL = "/sw.js";

/**
 * このブラウザのプッシュ通知の状態（設定の「このブラウザ」のカードと帯が出し分けに使う）。
 * - server-disabled: サーバーに VAPID の鍵がない。画面は 6.14b のデスクトップ通知のまま（決定 9）
 * - unsupported: Service Worker か Push API がない
 * - install: iPhone / iPad で、ホーム画面に追加していない（追加した hibari だけが受け取れる。決定 1）
 * - denied: ブラウザで通知が拒否されている
 * - off: 購読していない（許可がまだ決まっていない default も含む。押せば許可を求めてから購読まで進む。決定 2）
 * - on: このブラウザで購読していて、サーバーに登録してある
 */
export type BrowserPushState = "server-disabled" | "unsupported" | "install" | "denied" | "off" | "on";

type PushSubscriptionLike = {
  readonly options: { readonly applicationServerKey: ArrayBuffer | null };
  toJSON(): PushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
};

type PushManagerLike = {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: boolean; applicationServerKey: BufferSource }): Promise<PushSubscriptionLike>;
};

type RegistrationLike = { readonly pushManager: PushManagerLike };

export type PushBrowser = {
  /** `navigator.serviceWorker`。ない環境（http の別ホスト・古いブラウザ）では undefined。 */
  serviceWorker?: {
    register(url: string, options: RegistrationOptions): Promise<RegistrationLike>;
    getRegistration(): Promise<RegistrationLike | undefined>;
  };
  /** `PushManager` があるか。iPhone の Safari は、ホーム画面に追加していないとこれがない。 */
  pushManager: boolean;
  /** `Notification`。ない環境では undefined。 */
  notification?: { readonly permission: NotificationPermission; requestPermission(): Promise<NotificationPermission> };
  /** iPhone / iPad か。 */
  ios: boolean;
  /** ホーム画面から開いた（standalone の）hibari か。 */
  standalone: boolean;
};

/** ブラウザがプッシュを受けられるか（サーバーの設定と許可は見ない）。 */
export function browserPushSupport(browser: PushBrowser): "ok" | "unsupported" | "install" {
  // iPhone の Safari は、ホーム画面に追加していないと PushManager を出さない。「対応していない」ではなく「追加すれば使える」と案内する
  if (browser.ios && !browser.standalone) return "install";
  if (!browser.serviceWorker || !browser.pushManager || !browser.notification) return "unsupported";
  return "ok";
}

/** base64url（詰め物なし）をバイト列にする。applicationServerKey に渡す形。 */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const view = new Uint8Array(a);
  return view.every((byte, i) => byte === b[i]);
}

/** `PushSubscription.toJSON()` を API の形にする。鍵がなければ（ありえないが）null。 */
export function subscriptionRequest(subscription: PushSubscriptionLike): PushSubscriptionRequest | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

export type WebPush = {
  /** いまの状態。サーバーの設定（`GET /api/v1/push/config`）を 1 度だけ読む。 */
  state(): Promise<BrowserPushState>;
  /**
   * 許可を求めてから購読し、サーバーに登録する。**ボタンを押した操作の中で呼ぶこと**（Safari は、操作のあとに await を挟んだ
   * 許可の要求を拒む。なので許可の要求を最初に呼び、設定は state() で先に読んでおく）。
   * 戻り値は結果の状態。登録に失敗したら投げる（画面は「失敗」を出す）。
   */
  enable(): Promise<BrowserPushState>;
  /** このブラウザで止める（サーバーの購読を消してから、ブラウザの購読を外す）。 */
  disable(): Promise<void>;
  /** ページを開いたときに、いまの購読をサーバーに登録し直す（決定 4）。失敗しても投げない。 */
  resync(): Promise<void>;
  /** 自分の購読の一覧（設定の「通知を受け取る端末」）。 */
  listDevices: PushApi["listPushSubscriptions"];
  /** ほかの端末の購読を止める。 */
  stopDevice: PushApi["deletePushSubscriptionById"];
  /** このブラウザでプッシュが有効か（同期で読む。タブの通知が二重に出さないために見る。決定 2）。 */
  enabled(): boolean;
  /** enabled が変わったら知らせる（useSyncExternalStore 用）。 */
  subscribe(listener: () => void): () => void;
};

type WebPushApi = Pick<
  PushApi,
  "getPushConfig" | "putPushSubscription" | "deletePushSubscription" | "listPushSubscriptions" | "deletePushSubscriptionById"
>;

export function createWebPush(api: WebPushApi, browser: PushBrowser): WebPush {
  let config: Promise<{ enabled: boolean; key?: Uint8Array<ArrayBuffer> }> | undefined;
  let on = false;
  const listeners = new Set<() => void>();

  function setOn(next: boolean) {
    if (on === next) return;
    on = next;
    for (const listener of listeners) listener();
  }

  function readConfig() {
    config ??= api.getPushConfig().then(
      (c) => ({ enabled: c.enabled && !!c.vapid_public_key, key: c.vapid_public_key ? base64UrlToBytes(c.vapid_public_key) : undefined }),
      (error: unknown) => {
        // 読めなかったら覚えない（次に呼んだときに読み直す）
        config = undefined;
        throw error;
      },
    );
    return config;
  }

  function register(): Promise<RegistrationLike> {
    // updateViaCache: none は、sw.js を HTTP のキャッシュから読まず、更新をすぐに拾うため（Next.js の PWA の手引きと同じ）
    return browser.serviceWorker!.register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" });
  }

  /**
   * いまの鍵で作った購読を返す。サーバーの鍵が変わっていたら（古い鍵の購読にはもう送れない）、外して作り直す。
   * create が false なら、購読がないときに作らない。
   */
  async function currentSubscription(key: Uint8Array<ArrayBuffer>, create: boolean): Promise<PushSubscriptionLike | null> {
    const { pushManager } = await register();
    let subscription = await pushManager.getSubscription();
    if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
      await subscription.unsubscribe();
      subscription = null;
      // 鍵が変わっただけなので、もともと購読していたブラウザでは作り直す
      create = true;
    }
    if (subscription || !create) return subscription;
    return pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }

  async function putOrThrow(subscription: PushSubscriptionLike) {
    const request = subscriptionRequest(subscription);
    if (!request) throw new Error("push subscription has no keys");
    await api.putPushSubscription(request);
  }

  async function state(): Promise<BrowserPushState> {
    const { enabled } = await readConfig();
    if (!enabled) return "server-disabled";
    const support = browserPushSupport(browser);
    if (support !== "ok") return support;
    const permission = browser.notification!.permission;
    if (permission === "denied") return "denied";
    return permission === "granted" && on ? "on" : "off";
  }

  return {
    state,

    async enable() {
      if (browserPushSupport(browser) !== "ok") return state();
      // 最初に許可を求める（上の説明。操作のすぐあとでないと Safari が拒む）
      const permission =
        browser.notification!.permission === "granted" ? "granted" : await browser.notification!.requestPermission();
      if (permission !== "granted") return permission === "denied" ? "denied" : "off";
      const { enabled, key } = await readConfig();
      if (!enabled || !key) return "server-disabled";
      const subscription = await currentSubscription(key, true);
      try {
        await putOrThrow(subscription!);
      } catch (error) {
        // サーバーに登録できなかった購読は外す。残すと、次に開いたときの resync で、押していないのに有効になる
        await subscription!.unsubscribe().catch(() => false);
        setOn(false);
        throw error;
      }
      setOn(true);
      return "on";
    },

    async disable() {
      // サーバーを先に消す。消せなければ投げて、ブラウザの購読も残す（画面は有効のまま）
      await api.deletePushSubscription();
      setOn(false);
      const registration = await browser.serviceWorker?.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
    },

    async resync() {
      try {
        const { enabled, key } = await readConfig();
        if (!enabled || !key || browserPushSupport(browser) !== "ok" || browser.notification!.permission !== "granted") {
          setOn(false);
          return;
        }
        const subscription = await currentSubscription(key, false);
        if (!subscription) {
          setOn(false);
          return;
        }
        await putOrThrow(subscription);
        setOn(true);
      } catch {
        // 登録できなければ、このブラウザではタブの通知に任せる（プッシュが届かないのに、タブの通知まで止めない）。次に開いたときにまた試す
        setOn(false);
      }
    },

    listDevices: () => api.listPushSubscriptions(),
    stopDevice: (subscriptionId) => api.deletePushSubscriptionById(subscriptionId),

    enabled: () => on,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * ログアウトするときに、このブラウザの購読を外す。サーバーの行は失効のイベント（`auth:revoked`）で chat が消す（決定 3）。
 *
 * ブラウザの購読を残すと、同じブラウザで次にログインした人が開いたときの resync で、その人が押していないのに有効になる
 * （サーバーは同じ endpoint を新しい人へ移す。決定 3）。購読は sid に結び付けるので、ログインし直したら有効にし直してもらう。
 * Service Worker が登録されていなければ何もしない（`serviceWorker.ready` は登録がないと終わらないので getRegistration を使う）。
 */
export async function forgetBrowserPush(serviceWorker: PushBrowser["serviceWorker"]): Promise<void> {
  try {
    const registration = await serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // 外せなくてもログアウトは止めない（サーバーの行は消えるので、届くことはない）
  }
}

/** 本物のブラウザの API。サーバーでの描画では呼ばない。 */
export function browserPushEnv(): PushBrowser {
  const nav = navigator as Navigator & { standalone?: boolean };
  // iPadOS の Safari は Mac を名乗るので、触れる画面かどうかで見分ける
  const ios = /\biPhone|\biPad|\biPod/u.test(nav.userAgent) || (/\bMacintosh/u.test(nav.userAgent) && nav.maxTouchPoints > 1);
  const standalone = nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
  return {
    serviceWorker: "serviceWorker" in nav ? nav.serviceWorker : undefined,
    pushManager: "PushManager" in window,
    notification: "Notification" in window ? window.Notification : undefined,
    ios,
    standalone,
  };
}
