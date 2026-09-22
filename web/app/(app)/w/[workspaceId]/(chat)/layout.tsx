"use client";

import type { ReactNode } from "react";

import { WorkspaceScreen } from "@/app/(app)/w/[workspaceId]/(chat)/_components/workspace-screen";

/**
 * ワークスペースの画面（`/w/{id}` と `/w/{id}/r/{roomId}`）。
 *
 * サイドバー・ルーム・メンバーパネルはまとめてここで描く。ChatLayout がこの 3 つを横に並べる 1 つの要素で、
 * メンバーパネルだけをページに置くことができないため。ルームを移ってもレイアウトは作り直されないので、
 * サイドバーの検索語やスクロール位置が残る。page.tsx は URL を定義するだけで、何も描かない。
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WorkspaceScreen />
      {children}
    </>
  );
}
