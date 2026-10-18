import type { HuddleCall } from "./call";
import type { HuddleWindow } from "./window";

/**
 * ハドルの画面をどこに出すか（ADR 0066 追記 C）。
 * - popup: 別のタブ（about:blank）。md 以上の既定
 * - overlay: 同じタブの全画面。モバイルと、ブラウザがタブを開くのを止めたとき
 * - none: 出していない。通話中なら、チャットのタブの下にハドルの帯を出す
 */
export type HuddleSurface = { kind: "none" } | { kind: "popup"; window: HuddleWindow } | { kind: "overlay" };

export function createHuddleSurface({
  call,
  openWindow,
  preferOverlay,
}: {
  call: HuddleCall;
  /** タブを開く。止められたら null。onClose はタブが閉じられたとき。 */
  openWindow: (onClose: () => void) => HuddleWindow | null;
  /** 別のタブではなく全画面に出す（モバイル）。 */
  preferOverlay: () => boolean;
}) {
  let surface: HuddleSurface = { kind: "none" };
  const listeners = new Set<() => void>();

  function set(next: HuddleSurface) {
    surface = next;
    for (const l of listeners) l();
  }

  function windowClosed(w: HuddleWindow) {
    if (surface.kind !== "popup" || surface.window !== w) return;
    set({ kind: "none" });
    // 閉じても通話からは抜けない（帯に戻る）。入る前のプレビューと知らせは、閉じたら終わり
    const phase = call.getSnapshot().phase;
    if (phase === "preview") call.cancelPreview();
    if (phase === "problem") call.dismissProblem();
  }

  /** 画面を出す。タブが開いていれば前に出し、なければ開く。ボタンを押した操作の中で呼ぶこと。 */
  function show() {
    if (surface.kind === "popup") {
      surface.window.focus();
      return;
    }
    if (surface.kind === "overlay") return;
    if (!preferOverlay()) {
      const w: HuddleWindow | null = openWindow(() => w && windowClosed(w));
      if (w) {
        set({ kind: "popup", window: w });
        return;
      }
    }
    set({ kind: "overlay" });
  }

  function hide() {
    const current = surface;
    set({ kind: "none" });
    if (current.kind === "popup") current.window.close();
  }

  // 通話が終わったら（抜けた・キャンセルした）、画面も閉じる
  call.subscribe(() => {
    if (call.getSnapshot().phase === "idle" && surface.kind !== "none") hide();
  });

  return {
    getSnapshot: () => surface,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show,
    hide,
    /**
     * ヘッダーのボタン・会話の「参加」（決定 17）。通話していなければ、画面を出して参加前のプレビューにする。
     * もう通話していれば、そのハドルの画面を出す（同時に 2 つのハドルには入らない。オーナーの判断で、切り替えは作らない）。
     */
    start(roomId: string) {
      show();
      if (call.getSnapshot().phase !== "call") void call.openPreview(roomId);
    },
  };
}

export type HuddleSurfaceStore = ReturnType<typeof createHuddleSurface>;
