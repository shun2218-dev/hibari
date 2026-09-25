"use client";

import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";

import { EmojiPicker } from "@/components/chat/emoji-picker";
import type { MessageEditingView } from "@/components/chat/message-item/message-item";
import { DeleteMessageDialog } from "@/components/chat/dialogs/delete-message";
import type { MessageActions } from "@/components/chat/timeline";
import { ApiError } from "@/lib/api/error";
import type { Message, Role, Room, UserProfile } from "@/lib/api/types.gen";
import { useChatState, useChatStore } from "./use-chat-store";
import { useMessageAttachments } from "./use-message-attachments";
import { buildPermalink } from "@/lib/chat/format/links";
import type { MentionCandidate } from "@/lib/chat/format/mentions";
import { useOrigin } from "@/hooks/use-origin";
import { messageActions } from "@/lib/chat/views/permissions";
import { currentTheme, serverTheme, subscribeTheme } from "@/lib/theme";

/** コピーの結果をメニューに出しておく時間。 */
const COPIED_LABEL_MS = 2_000;

/**
 * メッセージの「…」メニュー・その場での編集・削除の確認（ADR 0027）と、「リンクをコピー」（ADR 0040）。
 * チャンネルのタイムラインと、スレッドのパネル（ADR 0036）の両方で使う。操作の可否の規則は同じ（ADR 0012）。
 */
export function useMessageActions({
  workspaceId,
  roomId,
  room,
  messages,
  me,
  myRole,
  members,
  mentionCandidates = [],
  canReact = false,
  canPin = false,
}: {
  workspaceId: string;
  roomId: string;
  room: Room | undefined;
  /** 操作の対象になりうるメッセージ（タイムラインに出しているもの）。 */
  messages: readonly Message[] | undefined;
  me: UserProfile | undefined;
  myRole: Role | undefined;
  /** 送信者のロールを引くためのルームのメンバー。取れていなければ undefined。 */
  members: readonly { user: { id: string }; role: Role }[] | undefined;
  /** 編集で `<@ULID>` を `@ハンドル` に戻し、保存で戻すのに使う候補（ADR 0043）。 */
  mentionCandidates?: readonly MentionCandidate[];
  /**
   * 絵文字のリアクションを付けられるか（ADR 0044 決定 6）。投稿できる人だけ。
   * 参加していない public ルームは読めるだけなので false にする。
   */
  canReact?: boolean;
  /**
   * ピン留めを付け外しできるか（ADR 0054 決定 4。authz.CanPinMessage の写し）。いまは投稿できる人と同じ。
   * 参加していない public ルームは読めるだけなので false にする。
   */
  canPin?: boolean;
}): {
  timelineProps: {
    actionsFor: (key: string) => MessageActions;
    copyLinkFor: (key: string) => { label: string; onClick: () => void } | undefined;
    pinFor: (key: string) => { label: string; onClick: () => void } | undefined;
    threadNotifyFor: (key: string) => { notifying: boolean; onClick: () => void } | undefined;
    saveFor: (key: string) => { saved: boolean; onClick: () => void } | undefined;
    openMenuKey: string | undefined;
    onToggleMenu: (key: string) => void;
    onEdit: (key: string) => void;
    onDelete: (key: string) => void;
    editingKey: string | undefined;
    editing: MessageEditingView | undefined;
    onToggleReaction: ((key: string, emoji: string) => void) | undefined;
    onTogglePicker: ((key: string) => void) | undefined;
    openPickerKey: string | undefined;
    reactionPicker: ReactNode;
    onDownload: (attachmentId: string) => void;
    onOpenImage: (key: string, attachmentId: string) => void;
    onDeleteAttachment: (key: string, attachmentId: string) => void;
    openAttachmentMenu: { key: string; attachmentId: string } | undefined;
    onToggleAttachmentMenu: (key: string, attachmentId: string) => void;
    onRemoveLinkPreview: (key: string, previewId: string) => void;
  };
  /** タイムラインの上に重ねるもの（削除の確認と、画像の拡大表示）。呼ぶ側はそのまま置く。 */
  overlays: ReactNode;
} {
  const store = useChatStore();
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  // 参加中のスレッド（返信の通知の状態。ADR 0056）。ワークスペースを開いたときに取ってある
  const followedThreads = useChatState((s) => s.threadLists[workspaceId]?.list);
  const [openPickerKey, setOpenPickerKey] = useState<string>();
  // emoji-mart はテーマを props で受け取るので、`data-theme` を購読して渡す（ADR 0031 / 0044）
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);
  const [editing, setEditing] = useState<{ messageId: string; value: string; saving: boolean } | null>(null);
  const [deleting, setDeleting] = useState<{
    messageId: string;
    body: string;
    mentionNames: Record<string, string>;
    pending: boolean;
  } | null>(null);
  // コピーの結果は、メニューの項目の文言を短い間だけ変えて伝える（トーストの仕組みを新しく作らない。ADR 0040）
  const [copied, setCopied] = useState<{ messageId: string; ok: boolean } | null>(null);
  const origin = useOrigin();
  // 編集のときは入力欄と同じ `@ハンドル` の形で見せ、保存するときに保存の形へ戻す（ADR 0043）

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), COPIED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const findMessage = (key: string) => messages?.find((m) => m.id === key);
  // 添付（ダウンロード・拡大表示・削除）は別のフックに分けてある
  const attachments = useMessageAttachments({
    roomId,
    findMessage,
    canDelete: (messageId) => actionsFor(messageId).canDelete,
  });
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

  /**
   * メッセージへのパーマリンクをコピーする（ADR 0040）。
   * 読めている人なら誰でもコピーできるので、権限では出し分けない。送信中のメッセージにはまだ ID がないので出さない。
   */
  function copyLinkFor(key: string): { label: string; onClick: () => void } | undefined {
    const message = findMessage(key);
    if (!message || origin === undefined || message.deleted_at !== null) return undefined;
    if (copied?.messageId === message.id) {
      return { label: copied.ok ? "コピーしました" : "コピーできませんでした", onClick: () => {} };
    }
    return {
      label: "リンクをコピー",
      onClick: async () => {
        const href = buildPermalink(origin, {
          workspaceId,
          roomId,
          messageId: message.id,
          ...(message.thread_root_id !== null ? { threadRootId: message.thread_root_id } : {}),
        });
        try {
          await navigator.clipboard.writeText(href);
          setCopied({ messageId: message.id, ok: true });
        } catch (err) {
          // クリップボードが使えない・拒否された。document.execCommand の代替は入れない（非推奨）
          console.error("failed to copy a message link", err);
          setCopied({ messageId: message.id, ok: false });
        }
      },
    };
  }

  /**
   * 「…」のスレッドの返信の通知（ADR 0056）。返信の付いた親にだけ出す（返信のない親はフォローできない）。
   * 設定を持てるのはルームのメンバーだけ（参加していない public ルームでは出さない）。
   * 参加していない・オフのスレッドは「新しい返信の通知を受け取る」、オンなら「返信の通知をオフにする」。
   */
  function threadNotifyFor(key: string): { notifying: boolean; onClick: () => void } | undefined {
    const message = findMessage(key);
    if (!room?.is_member || !message?.thread || message.thread.reply_count === 0) return undefined;
    const notifying = followedThreads?.find((t) => t.root.id === message.id)?.notify_replies ?? false;
    return {
      notifying,
      onClick: () => {
        setOpenMenuKey(undefined);
        void store.setThreadNotifications(workspaceId, roomId, message.id, !notifying).catch((err: unknown) => {
          // 失敗の表示はデザインにない。手元の表示は元に戻っている
          console.error("failed to change thread notifications", err);
        });
      },
    };
  }

  /**
   * 「…」のピン留めの付け外し（ADR 0054）。文言は Slack と同じく、チャンネルと DM で変える。
   * 送信中のメッセージ（まだ ID がない）と削除済みには出さない。失敗の表示はデザインにないので、戻らないまま閉じる。
   */
  function pinFor(key: string): { label: string; onClick: () => void } | undefined {
    const message = findMessage(key);
    if (!canPin || !message || !room || message.deleted_at !== null || message.kind === "system") return undefined;
    const dm = room.kind === "dm";
    const pinned = message.pinned !== null;
    return {
      label: pinned
        ? dm
          ? "この会話からピンを外す"
          : "チャンネルからピンを外す"
        : dm
          ? "この会話にピン留めする"
          : "チャンネルへピン留めする",
      onClick: () => {
        setOpenMenuKey(undefined);
        void store.togglePin(roomId, message.id).catch((err: unknown) => {
          console.error("failed to toggle a pin", err);
        });
      },
    };
  }

  /**
   * ホバーの「後で」（ADR 0054）。読める人なら誰でも保存できる（参加していない public ルームも）。
   * 印の楽観的更新と戻すのはデータ層（store）の仕事。失敗の表示はデザインにないので、戻った結果をそのまま見せる。
   */
  function saveFor(key: string): { saved: boolean; onClick: () => void } | undefined {
    const message = findMessage(key);
    if (!message || message.deleted_at !== null || message.kind === "system") return undefined;
    return {
      saved: message.saved ?? false,
      onClick: () =>
        void store.toggleSaved(workspaceId, roomId, message.id).catch((err: unknown) => {
          console.error("failed to toggle a saved message", err);
        }),
    };
  }

  async function saveEdit() {
    if (!activeEditing || !editingMessage) return;
    // 編集欄の値は送る形のテキスト（ADR 0052 決定 3）
    const body = activeEditing.value;
    if (body === editingMessage.body) {
      setEditing(null);
      return;
    }
    setEditing({ ...activeEditing, saving: true });
    try {
      await store.editMessage(roomId, activeEditing.messageId, body);
      setEditing(null);
    } catch (err) {
      // 失敗の表示はデザインにない。消されていた（409）・読めなくなった（404）なら閉じ、それ以外は保存し直せるように戻す
      console.error("failed to edit message", err);
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) setEditing(null);
      else setEditing((current) => current && { ...current, saving: false });
    }
  }

  /**
   * リアクションを付け外しする（ADR 0044）。楽観的更新と元に戻すのはデータ層（store）の仕事。
   * 失敗の表示はデザインにないので、ここでは戻った結果をそのまま見せる。
   */
  function toggleReaction(key: string, emoji: string) {
    void store.toggleReaction(roomId, key, emoji).catch((err: unknown) => {
      console.error("failed to toggle a reaction", err);
    });
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
      copyLinkFor,
      pinFor,
      threadNotifyFor,
      saveFor,
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
        // 引用は本文と同じ解釈で出す（書式とメンションのチップ。ADR 0051）
        if (message)
          setDeleting({
            messageId: message.id,
            body: message.body,
            mentionNames: Object.fromEntries(message.mentions.flatMap((m) => (m.user ? [[m.user.id, m.user.display_name]] : []))),
            pending: false,
          });
      },
      onDownload: attachments.onDownload,
      onOpenImage: (key, attachmentId) => {
        setOpenMenuKey(undefined);
        setOpenPickerKey(undefined);
        attachments.openImage(key, attachmentId);
      },
      onDeleteAttachment: attachments.onDeleteAttachment,
      openAttachmentMenu: attachments.openAttachmentMenu,
      onToggleAttachmentMenu: attachments.onToggleAttachmentMenu,
      // リンクのプレビューを消す（ADR 0065 決定 5）。確認しない。「x」を出すのは編集できる（本人の）メッセージだけ（Timeline が actionsFor で絞る）。
      // 楽観的更新と戻すのはデータ層の仕事。失敗の表示はデザインにないので、戻った結果をそのまま見せる
      onRemoveLinkPreview: (key, previewId) =>
        void store.removeLinkPreview(roomId, key, previewId).catch((err: unknown) => {
          console.error("failed to remove a link preview", err);
        }),
      onToggleReaction: canReact ? toggleReaction : undefined,
      onTogglePicker: canReact
        ? (key) => {
            setOpenMenuKey(undefined);
            setOpenPickerKey((current) => (current === key ? undefined : key));
          }
        : undefined,
      openPickerKey: canReact ? openPickerKey : undefined,
      reactionPicker: openPickerKey === undefined ? null : (
        <EmojiPicker
          theme={theme}
          onPick={(emoji) => {
            toggleReaction(openPickerKey, emoji);
            setOpenPickerKey(undefined);
          }}
        />
      ),
      editingKey: activeEditing?.messageId,
      editing: activeEditing
        ? {
            value: activeEditing.value,
            mentionCandidates,
            saving: activeEditing.saving,
            onChange: (value) => setEditing({ ...activeEditing, value }),
            onSave: saveEdit,
            onCancel: () => setEditing(null),
          }
        : undefined,
    },
    overlays: (
      <>
        <DeleteMessageDialog
          open={deleting !== null}
          body={deleting?.body ?? ""}
          mentionNames={deleting?.mentionNames}
          pending={deleting?.pending}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
        {attachments.overlays}
      </>
    ),
  };
}
