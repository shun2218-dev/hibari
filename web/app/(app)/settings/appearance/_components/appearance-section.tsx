"use client";

import { useSyncExternalStore } from "react";

import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { currentTheme, saveTheme, serverTheme, subscribeTheme } from "@/lib/theme";

/**
 * 外観（ADR 0031）。
 *
 * テーマは端末ごとの好みなので localStorage に置き、`<html data-theme>` で切り替える（OS には追従しない。CLAUDE.md）。
 * 表示の密度は、値（行送りと余白）がデザインにないので選べないままにしてある（`docs/ui/README.md` の未解決）。
 */
export function AppearanceSection() {
  // テーマは DOM（`data-theme`）を正にして購読する。session や chat のストアと同じ形
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);

  return (
    <AppearanceSettings
      theme={theme}
      density="comfortable"
      densityLocked
      onThemeChange={saveTheme}
    />
  );
}
