import type { Metadata } from "next";

import { paneSizeBootScript } from "@/lib/pane-size";
import { themeBootScript } from "@/lib/theme";
import { SessionProvider } from "@/providers/session-provider";

import { instrumentSans, jetBrainsMono, zenKakuGothicNew } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "hibari",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${instrumentSans.variable} ${zenKakuGothicNew.variable} ${jetBrainsMono.variable}`}
      // head のスクリプトが hydration の前に data-theme を付けるので、この要素の属性の差だけは警告にしない
      suppressHydrationWarning
    >
      <head>
        {/* 覚えているテーマを最初の描画の前に当てる（ダークの人にライトの画面を見せない。lib/theme.ts） */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* 覚えているエリアの大きさも同じく先に当てる（既定の幅で 1 度描いてから動くと画面がガタつく。lib/pane-size.ts） */}
        <script dangerouslySetInnerHTML={{ __html: paneSizeBootScript }} />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
