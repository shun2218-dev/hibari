/**
 * テストでの `next/font/google` の代わり。本物はビルド時に書体を取ってきて CSS のクラスを作るが、
 * jsdom では描画に関係しないので、同じ形の値だけ返す（app/fonts.ts が使う `variable` だけ）。
 */
const font = () => ({ variable: "", className: "", style: { fontFamily: "sans-serif" } });

export const Instrument_Sans = font;
export const JetBrains_Mono = font;
export const Zen_Kaku_Gothic_New = font;
