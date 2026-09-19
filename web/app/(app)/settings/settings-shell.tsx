"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SettingsLayout, type SettingsSection } from "@/components/settings/settings-layout";

export const settingsHrefs: Record<SettingsSection, string> = {
  profile: "/settings/profile",
  devices: "/settings/devices",
  appearance: "/settings/appearance",
};

/**
 * 設定の枠。`/settings`（モバイルの項目の一覧）はこの枠に入れず、各項目だけを枠に入れる。
 * モバイルの「戻る」は項目の一覧に戻る（デザインどおり）。
 */
export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const section = (Object.keys(settingsHrefs) as SettingsSection[]).find((name) => pathname.endsWith(`/${name}`));
  if (!section) return children;

  return (
    <SettingsLayout section={section} hrefs={settingsHrefs} backHref="/settings">
      {children}
    </SettingsLayout>
  );
}
