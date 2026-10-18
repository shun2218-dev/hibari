import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Provider } from "@/components/provider";

import "./global.css";

export const metadata: Metadata = {
  title: { template: "%s - hibari docs", default: "hibari docs" },
  description: "hibari の設計（ADR）と、フロントエンド・バックエンドの説明、REST の API リファレンス。",
  // 検索エンジンに載せない（ADR 0064 決定 6。robots.txt でも止める）
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
