"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type CreatableRoomKind, CreateRoomDialog } from "@/components/chat/dialogs/create-room";
import { useChatStore } from "@/hooks/chat/use-chat-store";

/**
 * チャンネルを作成して開く。
 * 作成したばかりのワークスペースにはルームがない（ADR 0011）ので、ここから始められないと先に進めない。
 */
export function CreateRoom({ workspaceId, open, onClose }: { workspaceId: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const store = useChatStore();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CreatableRoomKind>("public");
  const [creating, setCreating] = useState(false);

  function close() {
    setName("");
    setKind("public");
    onClose();
  }

  async function create() {
    setCreating(true);
    try {
      const room = await store.createRoom(workspaceId, { kind, name: name.trim() });
      close();
      router.push(`/w/${workspaceId}/r/${room.id}`);
    } catch (err) {
      // 名前の重複（room-name-taken）や通信の失敗を出す場所はデザインにない。ダイアログを残して、入力を直せるようにする
      console.error("failed to create room", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <CreateRoomDialog
      open={open}
      name={name}
      kind={kind}
      onNameChange={setName}
      onKindChange={setKind}
      creating={creating}
      onCancel={close}
      onCreate={create}
    />
  );
}
