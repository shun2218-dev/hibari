"use client";

import type { ReactNode } from "react";

import { SettingsLayout, type SettingsSection } from "@/components/settings/settings-layout";

import { noHref } from "./shared";

/**
 * ユーザーの設定（ADR 0031）。
 */
// ---- ユーザー設定 ----

export const settingsHrefs: Record<SettingsSection, string> = {
  profile: noHref,
  notifications: noHref,
  devices: noHref,
  appearance: noHref,
};

export function userSettings(section: SettingsSection, children: ReactNode) {
  return (
    <SettingsLayout section={section} hrefs={settingsHrefs} backHref={noHref} chatHref={noHref}>
      {children}
    </SettingsLayout>
  );
}
