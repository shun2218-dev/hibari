"use client";

import { useEffect, useRef } from "react";

import { rgbTriplet } from "@/lib/chat/reactions";

/**
 * emoji-mart の CSS 変数（`--em-*`）に写すトークン（ADR 0044 決定 7）。
 *
 * emoji-mart は自前の色の変数を持つので、`globals.css` の値を読んで渡す。
 * こうしておけば、ライト / ダークの切り替えも、トークンを変えたときも、ピッカーが勝手に付いてくる。
 * `--em-rgb-*` はライブラリの中で rgba 関数の引数として展開されるので、16 進ではなく `r, g, b` の形で渡す。
 */
const RGB_TOKENS = {
  "--em-rgb-color": "--color-text",
  "--em-rgb-accent": "--color-primary",
  "--em-rgb-background": "--color-surface",
  "--em-rgb-input": "--color-surface-muted",
} as const;

type EmojiPickerProps = {
  /** 絵文字を選んだ。native（👍 のような文字そのもの）を渡す。emoji-mart の id（`+1`）は使わない（ADR 0044 決定 4）。 */
  onPick: (emoji: string) => void;
  /**
   * ライト / ダーク。`auto` は OS の設定を見てしまうので使わず、こちらの `data-theme` から渡す（ADR 0031）。
   */
  theme: "light" | "dark";
};

/**
 * 絵文字のピッカー（ADR 0044 決定 7）。
 *
 * React ラッパー（`@emoji-mart/react`）は peer dependencies に React 19 が無いので使わず、
 * 本体が返す要素（カスタム要素）を div に挿す。本体は素の JS なので React のバージョンに縛られない。
 *
 * データは 1 MB を超えるので、**最初に開いたときだけ動的 import する**。最初の画面の表示には載せない。
 * 読み込みに失敗しても、チャットの他の部分は動き続けるべきなので、ここでは枠が空のままになるだけにする。
 */
export function EmojiPicker({ onPick, theme }: EmojiPickerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 選んだときのハンドラは描き直しのたびに変わるので、ピッカーを作り直さずに済むよう ref 越しに呼ぶ
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // トークンは host から読む（CSS 変数は継承するので、`data-theme` がどこに付いていても当たっている値が取れる）
    const tokens = getComputedStyle(host);
    for (const [target, source] of Object.entries(RGB_TOKENS)) {
      const triplet = rgbTriplet(tokens.getPropertyValue(source));
      // 読めなければ変数を置かず、ライブラリの既定色に任せる
      if (triplet !== undefined) host.style.setProperty(target, triplet);
    }
    host.style.setProperty("--em-color-border", "var(--color-border)");

    let picker: HTMLElement | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [{ Picker }, data, i18n] = await Promise.all([
          import("emoji-mart"),
          import("@emoji-mart/data").then((m) => m.default),
          import("@emoji-mart/data/i18n/ja.json").then((m) => m.default),
        ]);
        if (cancelled) return;
        picker = new Picker({
          data,
          i18n,
          locale: "ja",
          theme,
          // Unicode の絵文字だけを扱う（カスタム絵文字は作らない。ロードマップ Phase 6.7）
          set: "native",
          navPosition: "top",
          previewPosition: "none",
          // 1 行に並べる数は幅から決めさせる。モバイルでは画面いっぱいのシートになるため（ADR 0044 の Web の節）
          dynamicWidth: true,
          onEmojiSelect: (emoji: { native: string }) => onPickRef.current(emoji.native),
        }) as unknown as HTMLElement;
        // ライブラリの既定は中身の幅ぶんしか広がらない。置き場所（シート / ポップオーバー）に合わせる
        picker.style.width = "100%";
        host.appendChild(picker);
      } catch {
        // 読み込めなければピッカーが出ないだけにする。押し直せばもう一度試せる
      }
    })();

    return () => {
      cancelled = true;
      picker?.remove();
    };
  }, [theme]);

  // 幅は置き場所（モバイルはシート、md 以上はポップオーバー）が決める。高さはライブラリの既定に任せる
  return <div ref={hostRef} className="w-full" />;
}
