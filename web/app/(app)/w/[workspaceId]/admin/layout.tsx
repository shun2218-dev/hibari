import type { ReactNode } from "react";

import { AdminShell } from "./admin-shell";

/** ワークスペースの管理画面（`/w/{id}/admin/...`）。チャットの画面とは別のレイアウトで、全画面に出す。 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
