import type { ReactNode } from "react";

import { SettingsShell } from "@/app/(app)/settings/_components/settings-shell";

/** `/settings`（モバイルの項目の一覧）のタイトル。各項目のページは「プロフィール - 設定」のように上書きする。 */
export const metadata = { title: "設定" };

/** ユーザー設定（`/settings/...`）。チャットとは別の全画面のレイアウト。 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
