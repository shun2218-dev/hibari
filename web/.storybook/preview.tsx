import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { type ReactNode, useLayoutEffect } from "react";

import { instrumentSans, jetBrainsMono, zenKakuGothicNew } from "../app/fonts";

import "../app/globals.css";

/** app/layout.tsx が <html> に付けているもの。付けないと書体が変わり、撮り直した PNG が全部変わる。 */
const fontVariables = `${instrumentSans.variable} ${zenKakuGothicNew.variable} ${jetBrainsMono.variable}`;

/** 撮影の既定の大きさ。`mobile-` で始まる story は parameters で 390x844 を指定する（ADR 0047 決定 8）。 */
const defaultShotSize = "1280x800";

/**
 * 撮影の情報（大きさと出どころ）と、ダークの指定を <html> に写す。
 *
 * - `tools/shoot-ui.mjs` は index.json から story の一覧を取るが、**parameters は index.json に載らない**ので、
 *   描画したあとに `document.documentElement.dataset` から読む（ADR 0047 決定 8）。
 * - `data-theme` を囲いの div だけでなく <html> にも置くのは、body の直下に出るもの
 *   （絵文字のピッカー。components/ui/portal.tsx）がダークを拾えなくなるため。
 */
function HibariScreen({
  dark,
  size,
  source,
  children,
}: {
  dark: boolean;
  size: string;
  source: string;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.lang = "ja";
    html.className = fontVariables;
    html.dataset.shotSize = size;
    html.dataset.shotSource = source;
    if (dark) html.dataset.theme = "dark";
    return () => {
      delete html.dataset.theme;
    };
  }, [dark, size, source]);

  return (
    <div data-theme={dark ? "dark" : undefined} className="min-h-dvh bg-background text-text">
      {children}
    </div>
  );
}

const withHibariScreen: Decorator = (Story, { parameters }) => (
  <HibariScreen
    dark={parameters.theme === "dark"}
    size={parameters.screenshot?.size ?? defaultShotSize}
    source={parameters.screenshot?.source ?? "app"}
  >
    <Story />
  </HibariScreen>
);

const preview: Preview = {
  decorators: [withHibariScreen],
  parameters: {
    // 画面まるごとの story なので、Storybook の余白を付けない（PNG と同じ見た目にする）。
    layout: "fullscreen",
    // 画面を見るための story で、引数をいじる想定がないので下のパネルは畳んでおく。
    options: { showPanel: false },
    viewport: {
      options: {
        mobile: { name: "モバイル（390x844）", styles: { width: "390px", height: "844px" } },
      },
    },
  },
};

export default preview;
