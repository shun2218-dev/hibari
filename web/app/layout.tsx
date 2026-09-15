import type { Metadata } from "next";

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
    >
      <body>{children}</body>
    </html>
  );
}
