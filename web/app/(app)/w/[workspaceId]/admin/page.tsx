import { redirect } from "next/navigation";

/** 管理画面の入口。アカウントメニューからはここに来るので、最初の画面（設定）に移す。 */
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(`/w/${workspaceId}/admin/settings`);
}
