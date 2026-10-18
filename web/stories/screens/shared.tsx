"use client";

/**
 * どの画面でも使う値（リンク先と、押しても何も起きない操作）。
 */
export const noHref = "#";

export const roomHref = () => noHref;

// 渡したときだけ出る操作を、スクリーンショットと同じく出しておくための何もしないハンドラ。
export const noop = () => {};
