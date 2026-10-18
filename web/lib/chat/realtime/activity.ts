/**
 * この端末が「画面を見ているか」を決めて、変わったときだけ知らせる（ADR 0049 決定 3）。
 *
 * 見ているとみなすのは、次のすべてが成り立つとき。
 *  1. タブが見えている（`visibilitychange`）
 *  2. ウィンドウがフォーカスされている（`focus` / `blur`）
 *  3. 最後の操作から 10 分たっていない
 *
 * **10 分は 1 分ごとの点検で測る。** 操作のたびに 10 分のタイマーを張り直すと、スクロール中に何百回も作り直すことになる。
 * 端末がスリープから戻ったときも、点検なら次の 1 分で正しい値になる（タイマーはスリープ中に進まない）。
 */

/** 操作がないまま離席にするまでの時間。 */
export const IDLE_AFTER_MS = 10 * 60 * 1000;

/** 無操作の点検の間隔。 */
export const CHECK_INTERVAL_MS = 60 * 1000;

/**
 * 変化を送るまでに待つ時間。ウィンドウの行き来を連打されても、往復を 1 回にまとめる。
 * 値が元に戻ったら送らない（ADR 0049 決定 3）。
 */
export const SETTLE_MS = 1_000;

export type ActivityOptions = {
  /** 値が変わったときに呼ぶ（送るのは呼ぶ側）。 */
  onChange: (active: boolean) => void;
  /** いまタブが見えていて、ウィンドウがフォーカスされているか。 */
  isVisible: () => boolean;
  /** 見え方（visibility / focus）の変化を購読する。解除する関数を返す。 */
  watchVisibility: (onChange: () => void) => () => void;
  /** 操作（ポインタ・キー・ホイール・タッチ）を購読する。解除する関数を返す。 */
  watchInput: (onInput: () => void) => () => void;
  now?: () => number;
  idleAfterMs?: number;
  checkIntervalMs?: number;
  settleMs?: number;
};

export function createActivity({
  onChange,
  isVisible,
  watchVisibility,
  watchInput,
  now = Date.now,
  idleAfterMs = IDLE_AFTER_MS,
  checkIntervalMs = CHECK_INTERVAL_MS,
  settleMs = SETTLE_MS,
}: ActivityOptions) {
  let lastInputAt = now();
  // 最後に呼び出し側へ知らせた値。接続は「見ていない」から始まるので、初期値は false（ADR 0049 決定 3）
  let notified = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let checkTimer: ReturnType<typeof setInterval> | undefined;

  let unwatch: (() => void)[] = [];

  function compute(): boolean {
    return isVisible() && now() - lastInputAt < idleAfterMs;
  }

  function update() {
    // stop の後に購読が残っていても（解除の実装は呼ぶ側のもの）、何もしない
    if (unwatch.length === 0) return;
    const next = compute();
    if (next === notified) {
      // 待っている間に元の値へ戻ったら、送らずに済ませる
      clearTimeout(settleTimer);
      settleTimer = undefined;
      return;
    }
    if (settleTimer !== undefined) return;
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      const value = compute();
      if (value === notified) return;
      notified = value;
      onChange(value);
    }, settleMs);
  }

  return {
    start() {
      if (unwatch.length > 0) return;
      lastInputAt = now();
      unwatch = [
        watchVisibility(update),
        watchInput(() => {
          lastInputAt = now();
          update();
        }),
      ];
      checkTimer = setInterval(update, checkIntervalMs);
    },

    stop() {
      for (const off of unwatch) off();
      unwatch = [];
      clearInterval(checkTimer);
      clearTimeout(settleTimer);
      checkTimer = undefined;
      settleTimer = undefined;
    },

    /**
     * いまの値。つないだ直後に送るのに使う（接続は「見ていない」から始まるので、クライアントが今の値を送る）。
     * 送った値を「知らせ済み」として覚えるので、同じ値をもう一度送らない。
     */
    current(): boolean {
      notified = compute();
      return notified;
    },

    /** 再接続したときのために、知らせ済みの値を忘れる（サーバー側の接続は新しく、また「見ていない」から始まる）。 */
    reset() {
      notified = false;
    },
  };
}

export type Activity = ReturnType<typeof createActivity>;

/** ブラウザの見え方（タブが見えている and ウィンドウがフォーカスされている）。 */
export function windowVisible(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

/** 見え方の変化（タブの切り替え・ウィンドウの行き来）を購読する。 */
export function watchWindowVisibility(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
  };
}

/** 操作を購読する。捕捉フェーズで聞くのは、途中で止められるイベントも拾うため。 */
export function watchWindowInput(onInput: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  for (const type of events) window.addEventListener(type, onInput, { capture: true, passive: true });
  return () => {
    for (const type of events) window.removeEventListener(type, onInput, { capture: true });
  };
}
