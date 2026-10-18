"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

import Search from "@/components/search";

/**
 * ダークは hibari と同じく `<html data-theme="dark">` で切り替え、OS の設定には追従しない（CLAUDE.md「デザイン」、ADR 0064 決定 3）。
 */
export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      search={{ SearchDialog: Search }}
      theme={{ attribute: "data-theme", defaultTheme: "light", enableSystem: false }}
    >
      {children}
    </RootProvider>
  );
}
