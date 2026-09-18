import type { ReactNode } from "react";

import { SettingsShell } from "./settings-shell";

/** ユーザー設定（`/settings/...`）。チャットとは別の全画面のレイアウト。 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
