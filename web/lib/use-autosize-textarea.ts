"use client";

import { type RefObject, useEffect, useLayoutEffect } from "react";

/**
 * textarea の高さを中身に合わせて伸ばす。
 *
 * `rows` を増やすだけでは、短い文のときに空の行が居座る。中身の高さ（`scrollHeight`）を測って
 * 毎回入れ直すことで、1 行のときは 1 行、改行や折り返しで増えたら増えた分だけ伸びる。
 * 上限は CSS の `max-height` に任せる（そこから先は textarea の中でスクロールする）。
 */
export function useAutosizeTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  /**
   * 描き直しと同じ同期のタイミングで入れるのは、伸びる前の高さが 1 フレーム見えてしまう
   * （送信して空にした直後に高さが残って見える）のを避けるため。
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    resize(el);
  }, [ref, value]);

  /**
   * 幅が変わったら測り直す。横に細くなると同じ本文でも折り返しが増えるので、入れたままの高さでは足りなくなる
   * （サイドバーやパネルの幅を変えたとき、窓の大きさを変えたとき。ADR 0048）。
   */
  useEffect(() => {
    const el = ref.current;
    // ResizeObserver の無い環境（jsdom）では、幅が変わることもないので何もしない
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      // 高さだけの変化は自分で入れた分なので見ない（見ると測り直しが繰り返しになる）
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      resize(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

/**
 * 中身の高さを測って入れ直す。
 *
 * 測る前に一度 `height: auto` に戻すのは、`scrollHeight` が「いまの高さ」より小さくならないため。
 * 戻さないと、文字を消しても縮まない。
 */
function resize(el: HTMLTextAreaElement): void {
  // レイアウトを持たない環境（jsdom、非表示の親の中）では測れないので、CSS の既定の高さのままにする
  if (el.scrollHeight === 0) return;
  el.style.height = "auto";
  // scrollHeight は枠線を含まない。box-sizing: border-box のぶん、枠線の太さを足さないと 1 行分足りなくなる
  const borders = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + borders}px`;
}
