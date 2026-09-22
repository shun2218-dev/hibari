import { redirect } from "next/navigation";

/**
 * 「後で」の古い URL（ADR 0054）。左のメニューの「後で」に移したので（ADR 0058 決定 1）、`?side=later` に移す。
 * ルームは WorkspaceScreen が最後に開いたルームを選ぶ。
 */
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(`/w/${workspaceId}?side=later`);
}
