import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { type ReactNode, useLayoutEffect } from "react";

import { instrumentSans, jetBrainsMono, zenKakuGothicNew } from "../app/fonts";

import "../app/globals.css";

/** app/layout.tsx が <html> に付けているもの。付けないと書体が変わり、撮り直した PNG が全部変わる。 */
const fontVariables = `${instrumentSans.variable} ${zenKakuGothicNew.variable} ${jetBrainsMono.variable}`;

/** 撮影の既定の大きさ。`mobile-` で始まる story は parameters で 390x844 を指定する（ADR 0047 決定 8）。 */
const defaultShotSize = "1280x800";

/**
 * 撮影の指定（ADR 0047 決定 8）。**これを持つ story だけが「画面」**で、docs/ui/screenshots/ の PNG と 1 対 1 に対応する。
 * 部品の story（components/ 以下）は持たない。
 */
type ScreenshotParams = { size?: string; source?: "app" | "design" };

/**
 * story の囲い。
 *
 * - 撮影の情報を <html> に写す。`tools/shoot-ui.mjs` は index.json から story を選ぶが、
 *   **parameters は index.json に載らない**ので、描画したあとに `documentElement.dataset` から読む。
 * - `data-theme` を囲いの div だけでなく <html> にも置くのは、body の直下に出るもの
 *   （絵文字のピッカー。components/ui/portal.tsx）がダークを拾えなくなるため。
 */
function HibariFrame({ dark, shot, children }: { dark: boolean; shot?: ScreenshotParams; children: ReactNode }) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.lang = "ja";
    html.className = fontVariables;
    if (shot) {
      html.dataset.shotSize = shot.size ?? defaultShotSize;
      html.dataset.shotSource = shot.source ?? "app";
    }
    if (dark) html.dataset.theme = "dark";
    return () => {
      delete html.dataset.theme;
      delete html.dataset.shotSize;
      delete html.dataset.shotSource;
    };
  }, [dark, shot]);

  // 画面はスクリーンショットと同じく画面いっぱいに、部品は余白のある台の上に置く。
  const className = shot
    ? "min-h-dvh bg-background text-text"
    : "flex min-h-dvh items-center justify-center bg-background p-10 text-text";
  return (
    <div data-theme={dark ? "dark" : undefined} className={className}>
      {children}
    </div>
  );
}

const withHibariFrame: Decorator = (Story, { parameters, globals }) => {
  const shot = parameters.screenshot as ScreenshotParams | undefined;
  // 画面の story はテーマを固定する（PNG と 1 対 1 にするため）。部品の story はツールバーで切り替える。
  const dark = shot ? parameters.theme === "dark" : globals.theme === "dark";
  return (
    <HibariFrame dark={dark} shot={shot}>
      <Story />
    </HibariFrame>
  );
};

const preview: Preview = {
  decorators: [withHibariFrame],
  initialGlobals: { theme: "light" },
  globalTypes: {
    theme: {
      description: "テーマ（部品の story で使う。画面の story は parameters で固定してある）",
      toolbar: {
        title: "テーマ",
        icon: "contrast",
        items: [
          { value: "light", title: "ライト" },
          { value: "dark", title: "ダーク" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    // 囲いは decorator が持つので、Storybook 側の余白は付けない。
    layout: "fullscreen",
    options: {
      // サイドバーの並び。書かないと日本語の title が文字コード順に並んで、画面をたどる順番にならない。
      storySort: {
        order: [
          "認証",
          ["ログインと登録", "パスワードの再設定", "メールの確認"],
          "チャット",
          [
            "タイムライン",
            "メッセージの操作",
            "添付ファイル",
            "リアクション",
            "スレッド",
            "メンション",
            "リンクと移動",
            "チャンネルとメンバー",
            "ワークスペースの切り替え",
            "接続と同期",
          ],
          "招待",
          ["受け入れ"],
          "ワークスペースの管理",
          ["設定", "メンバー", "招待リンク"],
          "ユーザー設定",
          ["プロフィール", "デバイス", "外観", "移動"],
          // 部品のカタログは画面のあとに置く（ADR 0047 決定 12）。
          "components",
        ],
      },
    },
    viewport: {
      options: {
        mobile: { name: "モバイル（390x844）", styles: { width: "390px", height: "844px" } },
      },
    },
  },
};

export default preview;
