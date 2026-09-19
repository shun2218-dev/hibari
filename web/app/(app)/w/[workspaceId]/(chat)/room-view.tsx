"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyMessages, JoinRoomBar, RemovedFromWorkspace, RoomUnavailable } from "@/components/chat/chat-states";
import { Composer } from "@/components/chat/composer";
import { ConnectionBanner } from "@/components/chat/connection-banner";
import { DeleteMessageDialog } from "@/components/chat/room-dialogs";
import { RoomSettings } from "./room-settings";
import { RoomHeader } from "@/components/chat/room-header";
import { Timeline } from "@/components/chat/timeline";
import { ApiError } from "@/lib/api/error";
import { useSessionState } from "@/lib/auth/session-provider";
import {
  useAttachmentUploader,
  useAvatarUrls,
  useChatState,
  useChatStore,
  useMedia,
  useMediaState,
  useRealtime,
} from "@/lib/chat/chat-provider";
import { forgetLocation } from "@/lib/chat/last-location";
import type { OutgoingReply } from "@/lib/chat/store";
import { draftsReady } from "@/lib/chat/uploads";
import { messageActions, previewImageIds, roomName, toAttachmentDraftView, toTimelineItems } from "@/lib/chat/views";
import { useDocumentVisible } from "@/lib/use-document-visible";

/** 本文の上限（rune。ADR 0012）。超えたら送信できないようにする（送っても 422 で失敗にしかならない）。 */
const MAX_BODY_LENGTH = 4000;

type RoomViewProps = {
  workspaceId: string;
  roomId: string;
  membersOpen: boolean;
  onToggleMembers: () => void;
  onBack: () => void;
  onLeaveRemovedWorkspace: () => void;
};

/**
 * ブラウザにダウンロードさせる。GET URL は Content-Disposition: attachment で署名してある（ADR 0013）ので、
 * 開いてもページは移らずに保存が始まる。
 */
function startDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.click();
}

/**
 * ルームのヘッダー・接続状態・履歴・入力欄（返信・添付）・メッセージの編集と削除・参加の導線。
 * ルームごとに key を変えて作り直すので、タイムラインのスクロール位置はルームを開くたびにいちばん下から始まる。
 */
export function RoomView({
  workspaceId,
  roomId,
  membersOpen,
  onToggleMembers,
  onBack,
  onLeaveRemovedWorkspace,
}: RoomViewProps) {
  const router = useRouter();
  const store = useChatStore();
  const realtime = useRealtime();
  const media = useMedia();
  const { state: sessionState } = useSessionState();
  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const room = useChatState((s) => s.rooms[roomId]);
  const outgoing = useChatState((s) => s.outgoing[roomId]);
  const myRole = useChatState((s) => s.workspaces.list.find((w) => w.id === workspaceId)?.my_role);
  const members = useChatState((s) => s.roomMembers[roomId]?.members);
  const timeline = useChatState((s) => s.timelines[roomId]);
  const banner = useChatState((s) => s.connection.banner);
  const typing = useChatState((s) => s.typing[roomId]);
  const removal = useChatState((s) => s.removedRooms[roomId]);
  const workspaceRemoval = useChatState((s) => s.removedWorkspaces[workspaceId]);
  const [joining, setJoining] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  // 入力欄の本文と返信先。ルームごとに作り直すので、別のルームに移ると消える
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<OutgoingReply | null>(null);
  const { uploader, drafts } = useAttachmentUploader(roomId);
  const [sentCount, setSentCount] = useState(0);
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  const [editing, setEditing] = useState<{ messageId: string; value: string; saving: boolean } | null>(null);
  const [deleting, setDeleting] = useState<{ messageId: string; body: string; pending: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const visible = useDocumentVisible();

  useEffect(() => {
    store.openRoom(roomId);
  }, [store, roomId]);

  // 最新を見ているか（タブが見えていて、いちばん下が見えている）をデータ層に知らせる。見ている間に届いたメッセージは既読になる
  const ready = timeline?.status === "ready";
  useEffect(() => {
    store.setFocus({ roomId, caughtUp: ready && visible && atBottom });
  }, [store, roomId, ready, visible, atBottom]);
  useEffect(() => () => store.setFocus(null), [store]);

  // 読めないルーム（存在しない、private のメンバーではない）と、開いている間に外された非公開ルームは、
  // どちらも「アクセスできません」だけを出す。API と同じく、存在しないのか読めないのかを区別しない（ADR 0035）。
  // 覚えている場所からは外す（入口から開き直したときに、また開かないように）
  const unavailable = timeline?.status === "not_found" || removal === "removed";
  // 別のタブで自分から抜けたときは、お知らせを出さずに入口に戻す（ADR 0034）
  const left = removal === "left";
  // 別のワークスペースのルームの URL なら、そのワークスペースで開き直す
  const otherWorkspace = ready && room !== undefined && room.workspace_id !== workspaceId;
  useEffect(() => {
    if (unavailable) {
      forgetLocation(workspaceId, roomId);
    } else if (left) {
      forgetLocation(workspaceId, roomId);
      router.replace(`/w/${workspaceId}`);
    } else if (otherWorkspace) {
      router.replace(`/w/${room.workspace_id}/r/${roomId}`);
    }
  }, [unavailable, left, otherWorkspace, room, workspaceId, roomId, router]);

  // 古いページの取得中（loadingOlder）の切り替えでは timeline が変わるが、並びは変わらない。
  // 並びが変わったときだけ作り直し、タイムラインのスクロール位置の合わせ直しを起こさない
  const messages = timeline?.messages;
  const unreadAfterSeq = timeline?.unreadAfterSeq ?? null;

  // アバターと画像の URL は、chat のレスポンスに載らないので、画面に出すものの ID を集めて引く（ADR 0013 / 0020 / 0028）
  const senderIds = useMemo(() => [...(messages ?? []).map((m) => m.sender.id), ...(me ? [me.id] : [])], [messages, me]);
  const avatarUrls = useAvatarUrls(senderIds);
  const attachmentUrls = useMediaState((s) => s.attachments);
  const imageIds = useMemo(() => previewImageIds(messages ?? []).join(" "), [messages]);
  useEffect(() => {
    if (imageIds !== "") media.requestAttachmentUrls(imageIds.split(" "));
  }, [media, imageIds]);

  const items = useMemo(
    () => toTimelineItems(messages ?? [], { unreadAfterSeq, outgoing, me, avatarUrls, attachmentUrls }),
    [messages, unreadAfterSeq, outgoing, me, avatarUrls, attachmentUrls],
  );
  const draftViews = useMemo(() => drafts.map(toAttachmentDraftView), [drafts]);
  const typingNames = useMemo(() => (typing ?? []).map((t) => t.user.display_name), [typing]);

  // ワークスペースから外されたとき（下）は、ワークスペースのお知らせのほうを出す
  if (unavailable && workspaceRemoval?.reason !== "removed") {
    // 名前も人数も見せないので、ヘッダーごと出さない（ADR 0035）
    return <RoomUnavailable onBack={() => router.replace(`/w/${workspaceId}`)} />;
  }
  if (!room || otherWorkspace) return null;

  const findMessage = (key: string) => messages?.find((m) => m.id === key);
  const findOutgoing = (key: string) => outgoing?.find((m) => m.clientMsgId === key);
  // 編集中に削除された（別のタブ、管理者）ら、編集をやめる
  const editingMessage = editing ? findMessage(editing.messageId) : undefined;
  const activeEditing = editing && editingMessage?.deleted_at === null ? editing : null;
  // 添付があれば本文は空でもよい。アップロード中・失敗した添付が残っていたら送らない（ADR 0013 / 0028）
  const canSend =
    (draft.trim() !== "" || drafts.length > 0) && draftsReady(drafts) && [...draft].length <= MAX_BODY_LENGTH;

  function changeDraft(value: string) {
    setDraft(value);
    if (value.trim() !== "") realtime.sendTyping(roomId);
  }

  function send() {
    if (!canSend) return;
    store.sendMessage(roomId, { body: draft, replyTo, attachments: uploader.take() });
    setDraft("");
    setReplyTo(null);
    setSentCount((n) => n + 1);
  }

  function reply(key: string) {
    const message = findMessage(key);
    if (message) {
      setReplyTo({ messageId: message.id, clientMsgId: null, senderName: message.sender.display_name, body: message.body });
      return;
    }
    // 送信中の自分のメッセージにも返信できる。送る時点で確定した ID に置き換える（ADR 0027）
    const pending = findOutgoing(key);
    if (pending && me) {
      setReplyTo({ messageId: null, clientMsgId: pending.clientMsgId, senderName: me.display_name, body: pending.body });
    }
  }

  function actionsFor(key: string) {
    const message = findMessage(key);
    // 送信中のメッセージはまだ ID がないので、編集も削除もできない
    if (!message || !me) return { canEdit: false, canDelete: false };
    const senderRole = members?.find((m) => m.user.id === message.sender.id)?.role;
    return messageActions(message, { userId: me.id, room: room!, myRole, senderRole });
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

  async function download(attachmentId: string) {
    try {
      startDownload(await media.attachmentDownloadUrl(attachmentId));
    } catch (err) {
      // 失敗の表示はデザインにない
      console.error("failed to download an attachment", err);
    }
  }

  async function join() {
    setJoining(true);
    try {
      await store.joinRoom(roomId);
    } catch (err) {
      // 失敗の表示はデザインにない。ボタンを押せる状態に戻す
      console.error("failed to join room", err);
    } finally {
      setJoining(false);
    }
  }

  const removedFromWorkspace = workspaceRemoval?.reason === "removed";
  const header = (
    <RoomHeader
      kind={room.kind}
      name={roomName(room)}
      memberCount={room.member_count ?? 0}
      membersOpen={membersOpen}
      onToggleMembers={onToggleMembers}
      // DM は設定を変えられない（ADR 0011）。member にも読み取り専用で開ける。
      // ワークスペースから外されたら、もう読めないので出さない
      onOpenSettings={room.kind === "dm" || removedFromWorkspace ? undefined : () => setSettingsOpen(true)}
      onBack={onBack}
    />
  );

  // ワークスペースから外されたら、ヘッダーは残して本文を差し替える（chat/removed-from-workspace.png）
  if (removedFromWorkspace) {
    return (
      <>
        {header}
        <RemovedFromWorkspace workspaceName={workspaceRemoval.workspace.name} onMove={onLeaveRemovedWorkspace} />
      </>
    );
  }

  return (
    <>
      {header}
      <ConnectionBanner status={banner} />
      {/* 取得中と、取得できなかったとき（その画面はデザインにない）は、ヘッダーだけを出す */}
      {ready &&
        (items.length === 0 ? (
          <EmptyMessages kind={room.kind} name={roomName(room)} />
        ) : (
          <Timeline
            items={items}
            onReachStart={() => store.loadOlder(roomId)}
            onMarkAllRead={() => store.dismissUnread(roomId)}
            onAtBottomChange={setAtBottom}
            scrollToLatestKey={sentCount}
            onRetry={(key) => store.retryMessage(roomId, key)}
            onDiscard={(key) => store.discardMessage(roomId, key)}
            onReply={reply}
            onDownload={download}
            onImageError={(id, url) => media.attachmentImageFailed(id, url)}
            actionsFor={actionsFor}
            openMenuKey={openMenuKey}
            onToggleMenu={(key) => setOpenMenuKey((current) => (current === key ? undefined : key))}
            onEdit={(key) => {
              setOpenMenuKey(undefined);
              const message = findMessage(key);
              if (message) setEditing({ messageId: message.id, value: message.body, saving: false });
            }}
            onDelete={(key) => {
              setOpenMenuKey(undefined);
              const message = findMessage(key);
              if (message) setDeleting({ messageId: message.id, body: message.body, pending: false });
            }}
            editingKey={activeEditing?.messageId}
            editing={
              activeEditing
                ? {
                    value: activeEditing.value,
                    saving: activeEditing.saving,
                    onChange: (value) => setEditing({ ...activeEditing, value }),
                    onSave: saveEdit,
                    onCancel: () => setEditing(null),
                  }
                : undefined
            }
          />
        ))}
      {room.kind === "public" && !room.is_member ? (
        <JoinRoomBar joining={joining} onJoin={join} />
      ) : (
        ready && (
          <Composer
            value={draft}
            onChange={changeDraft}
            onSend={send}
            canSend={canSend}
            onSelectFiles={(files) => uploader.add(files)}
            attachments={draftViews}
            onRetryAttachment={(key) => uploader.retry(key)}
            onRemoveAttachment={(key) => uploader.remove(key)}
            typingNames={typingNames}
            replyTo={replyTo ?? undefined}
            onCancelReply={() => setReplyTo(null)}
          />
        )
      )}
      <DeleteMessageDialog
        open={deleting !== null}
        body={deleting?.body ?? ""}
        pending={deleting?.pending}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
      <RoomSettings
        workspaceId={workspaceId}
        roomId={roomId}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
