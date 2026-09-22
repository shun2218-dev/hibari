"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog";
import { useChatStore } from "@/hooks/chat/use-chat-store";

/**
 * ワークスペースを作成して、そのワークスペースに移る。
 * ワークスペースが 0 件の画面と、切り替えのポップオーバーの両方から開く。
 *
 * 0 件の画面は、一覧が 1 件になれば自分で移るので、navigate を false にして 2 回移らないようにする。
 */
export function CreateWorkspace({
  open,
  onClose,
  navigate = true,
}: {
  open: boolean;
  onClose: () => void;
  navigate?: boolean;
}) {
  const router = useRouter();
  const store = useChatStore();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  function close() {
    setName("");
    onClose();
  }

  async function create() {
    setCreating(true);
    try {
      const workspace = await store.createWorkspace(name.trim());
      close();
      if (navigate) router.push(`/w/${workspace.id}`);
    } catch (err) {
      // 入力の誤りは、空と長さを入力欄で防いでいる。通信の失敗や 500 の表示はデザインにないので、ダイアログを残すだけにする
      console.error("failed to create workspace", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <CreateWorkspaceDialog
      open={open}
      name={name}
      onNameChange={setName}
      creating={creating}
      onCancel={close}
      onCreate={create}
    />
  );
}
