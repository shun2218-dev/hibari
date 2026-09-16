import type { Metadata } from "next";

import { SessionProvider } from "@/lib/auth/session-provider";

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
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
