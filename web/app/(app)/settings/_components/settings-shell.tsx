"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { type SettingsHrefs, SettingsLayout, type SettingsSection } from "@/components/settings/settings-layout";

export const settingsHrefs = {
  profile: "/settings/profile",
  notifications: "/settings/notifications",
  devices: "/settings/devices",
  appearance: "/settings/appearance",
} satisfies SettingsHrefs;

/**
 * 設定の枠。`/settings`（モバイルの項目の一覧）はこの枠に入れず、各項目だけを枠に入れる。
 * モバイルの「戻る」は項目の一覧に戻る（デザインどおり）。
 */
export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const section = (Object.keys(settingsHrefs) as SettingsSection[]).find((name) => pathname.endsWith(`/${name}`));
  if (!section) return children;

  return (
    // 設定はワークスペースに属さないので、チャットへは入口（`/`）に戻す。最後に開いた場所が開く（ADR 0025）
    <SettingsLayout section={section} hrefs={settingsHrefs} backHref="/settings" chatHref="/">
      {children}
    </SettingsLayout>
  );
}
