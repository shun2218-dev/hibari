import { Instrument_Sans, JetBrains_Mono, Zen_Kaku_Gothic_New } from "next/font/google";

/*
 * 書体の読み込み。globals.css の --font-sans / --font-mono が、ここで定義する CSS 変数を参照する。
 *
 * next/font はビルド時に取得して自前で配信するので、閲覧時に Google へリクエストしない。
 * Instrument Sans と JetBrains Mono は可変フォントなのでウェイトを指定しない。
 * Zen Kaku Gothic New は可変ではないので、使うウェイトだけを読む（600 はないので 500 / 700 で近いほうが使われる）。
 * 和文はサブセットが大きく、先読みすると最初の表示が遅くなるので preload しない。
 */
export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-sans",
});

export const zenKakuGothicNew = Zen_Kaku_Gothic_New({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-zen-kaku-gothic-new",
});

export const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});
