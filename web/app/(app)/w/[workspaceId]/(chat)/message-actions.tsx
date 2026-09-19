"use client";

import { type ReactNode, useState } from "react";

import type { MessageEditingView } from "@/components/chat/message-item";
import { DeleteMessageDialog } from "@/components/chat/room-dialogs";
import type { MessageActions } from "@/components/chat/timeline";
import { ApiError } from "@/lib/api/error";
import type { Message, Role, Room, UserProfile } from "@/lib/api/types.gen";
import { useChatStore } from "@/lib/chat/chat-provider";
import { messageActions } from "@/lib/chat/views";

/**
 * メッセージの「…」メニュー・その場での編集・削除の確認（ADR 0027）。
 * チャンネルのタイムラインと、スレッドのパネル（ADR 0036）の両方で使う。操作の可否の規則は同じ（ADR 0012）。
 */
export function useMessageActions({
  roomId,
  room,
  messages,
  me,
  myRole,
  members,
}: {
  roomId: string;
  room: Room | undefined;
  /** 操作の対象になりうるメッセージ（タイムラインに出しているもの）。 */
  messages: readonly Message[] | undefined;
  me: UserProfile | undefined;
  myRole: Role | undefined;
  /** 送信者のロールを引くためのルームのメンバー。取れていなければ undefined。 */
  members: readonly { user: { id: string }; role: Role }[] | undefined;
}): {
  timelineProps: {
    actionsFor: (key: string) => MessageActions;
    openMenuKey: string | undefined;
    onToggleMenu: (key: string) => void;
    onEdit: (key: string) => void;
    onDelete: (key: string) => void;
    editingKey: string | undefined;
    editing: MessageEditingView | undefined;
  };
  deleteDialog: ReactNode;
} {
  const store = useChatStore();
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  const [editing, setEditing] = useState<{ messageId: string; value: string; saving: boolean } | null>(null);
  const [deleting, setDeleting] = useState<{ messageId: string; body: string; pending: boolean } | null>(null);

  const findMessage = (key: string) => messages?.find((m) => m.id === key);
  // 編集中に削除された（別のタブ、管理者）ら、編集をやめる
  const editingMessage = editing ? findMessage(editing.messageId) : undefined;
  const activeEditing = editing && editingMessage?.deleted_at === null ? editing : null;

  function actionsFor(key: string): MessageActions {
    const message = findMessage(key);
    // 送信中のメッセージはまだ ID がないので、編集も削除もできない
    if (!message || !me || !room) return { canEdit: false, canDelete: false };
    const senderRole = members?.find((m) => m.user.id === message.sender.id)?.role;
    return messageActions(message, { userId: me.id, room, myRole, senderRole });
  }

  async function saveEdit() {
    if (!activeEditing || !editingMessage) return;
    if (activeEditing.value === editingMessage.body) {
      setEditing(null);
      return;
    }
    setEditing({ ...activeEditing, saving: true });
    try {
      await store.editMessage(roomId, activeEditing.messageId, activeEditing.value);
      setEditing(null);
    } catch (err) {
      // 失敗の表示はデザインにない。消されていた（409）・読めなくなった（404）なら閉じ、それ以外は保存し直せるように戻す
      console.error("failed to edit message", err);
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) setEditing(null);
      else setEditing((current) => current && { ...current, saving: false });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleting({ ...deleting, pending: true });
    try {
      await store.deleteMessage(roomId, deleting.messageId);
      setDeleting(null);
    } catch (err) {
      // 失敗の表示はデザインにない。権限がない（403）・見つからない（404）なら閉じ、それ以外は押し直せるように戻す
      console.error("failed to delete message", err);
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setDeleting(null);
      else setDeleting((current) => current && { ...current, pending: false });
    }
  }

  return {
    timelineProps: {
      actionsFor,
      openMenuKey,
      onToggleMenu: (key) => setOpenMenuKey((current) => (current === key ? undefined : key)),
      onEdit: (key) => {
        setOpenMenuKey(undefined);
        const message = findMessage(key);
        if (message) setEditing({ messageId: message.id, value: message.body, saving: false });
      },
      onDelete: (key) => {
        setOpenMenuKey(undefined);
        const message = findMessage(key);
        if (message) setDeleting({ messageId: message.id, body: message.body, pending: false });
      },
      editingKey: activeEditing?.messageId,
      editing: activeEditing
        ? {
            value: activeEditing.value,
            saving: activeEditing.saving,
            onChange: (value) => setEditing({ ...activeEditing, value }),
            onSave: saveEdit,
            onCancel: () => setEditing(null),
          }
        : undefined,
    },
    deleteDialog: (
      <DeleteMessageDialog
        open={deleting !== null}
        body={deleting?.body ?? ""}
        pending={deleting?.pending}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    ),
  };
}
