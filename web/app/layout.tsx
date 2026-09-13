import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "hibari",
};

// 見た目（フォント・配色・レイアウト）は Phase 1.5 でデザインを取り込んでから決める。
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
