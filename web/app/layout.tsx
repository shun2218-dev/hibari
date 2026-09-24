import type { Metadata } from "next";

import { APP_DESCRIPTION, APP_NAME, TITLE_TEMPLATE } from "@/lib/document-title";
import { paneSizeBootScript } from "@/lib/pane-size";
import { themeBootScript } from "@/lib/theme";
import { SessionProvider } from "@/providers/session-provider";

import { instrumentSans, jetBrainsMono, zenKakuGothicNew } from "./fonts";
import "./globals.css";

// タイトルの形と説明（ADR 0063 決定 1 / 2）。各ページは「ログイン」のように開いているものだけを書き、template がアプリ名を付ける
export const metadata: Metadata = {
  title: { template: TITLE_TEMPLATE, default: APP_NAME },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  openGraph: { siteName: APP_NAME, locale: "ja_JP", type: "website" },
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
