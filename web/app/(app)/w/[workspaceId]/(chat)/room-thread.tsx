"use client";

import { useEffect, useMemo, useState } from "react";

import { JoinRoomBar } from "@/components/chat/chat-states";
import { Composer } from "@/components/chat/composer";
import { ThreadPanel } from "@/components/chat/thread-panel";
import { Timeline } from "@/components/chat/timeline";
import { useSessionState } from "@/lib/auth/session-provider";
import {
  useAttachmentUploader,
  useAvatarUrls,
  useChatState,
  useChatStore,
  useLinkCards,
  useMedia,
  useMediaState,
  useRealtime,
} from "@/lib/chat/chat-provider";
import { draftsReady } from "@/lib/chat/uploads";
import { useOrigin } from "@/lib/chat/use-origin";
import {
  alsoInChannelDoneLabel,
  alsoInChannelLabel,
  permalinksIn,
  previewImageIds,
  roomName,
  toAttachmentDraftView,
  toThreadTimelineItems,
} from "@/lib/chat/views";
import { useDocumentVisible } from "@/lib/use-document-visible";

import { useMessageActions } from "./message-actions";

/** 本文の上限（rune。ADR 0012）。チャンネルの入力欄と同じ。 */
const MAX_BODY_LENGTH = 4000;

function startDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.click();
}

/**
 * スレッドのパネル（ADR 0036、ADR 0037）。親・返信・入力欄をつなぐ。
 *
 * - 返信の送信はチャンネルと同じ送信の列に並べる（ルームで 1 本。ADR 0027）。楽観的に表示し、失敗したら再送できる
 * - 「チャンネルにも投稿する」を付けた返信は、チャンネルのタイムラインにも並ぶ（ADR 0039）
 * - 開いている間は、表示している最新の返信まで既読にする（タブが見えているときだけ）
 * - 親が見つからない（返信や存在しない ID の URL、読めなくなった）ときは閉じる。その画面はデザインにない
 */
export function RoomThread({
  workspaceId,
  roomId,
  rootId,
  onClose,
}: {
  workspaceId: string;
  roomId: string;
  rootId: string;
  onClose: () => void;
}) {
  const store = useChatStore();
  const realtime = useRealtime();
  const media = useMedia();
  const { state: sessionState } = useSessionState();
  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const room = useChatState((s) => s.rooms[roomId]);
  const thread = useChatState((s) => s.threads[rootId]);
  const outgoing = useChatState((s) => s.outgoing[roomId]);
  const typing = useChatState((s) => s.threadTyping[rootId]);
  const myRole = useChatState((s) => s.workspaces.list.find((w) => w.id === workspaceId)?.my_role);
  const members = useChatState((s) => s.roomMembers[roomId]?.members);
  const visible = useDocumentVisible();
  const [draft, setDraft] = useState("");
  // 「チャンネルにも投稿する」（ADR 0039）。送信後は決まった値を変えられないので、送るたびに外す（続けて返信するときに、
  // 付けたつもりのないものが流れないように）
  const [alsoInChannel, setAlsoInChannel] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [joining, setJoining] = useState(false);
  const { uploader, drafts } = useAttachmentUploader(roomId);

  useEffect(() => {
    void store.openThread(roomId, rootId);
    store.setThreadFocus({ roomId, rootId });
    return () => store.setThreadFocus(null);
  }, [store, roomId, rootId]);

  const status = thread?.status;
  const root = thread?.root ?? null;
  // 返信は親にできない（入れ子にしない）。返信の ID の URL を開いたら閉じる
  const notThread = status === "not_found" || (root !== null && root.thread_root_id !== null);
  useEffect(() => {
    if (notThread) onClose();
  }, [notThread, onClose]);

  const replies = thread?.replies;
  const newestReplySeq = replies?.at(-1)?.seq;
  const lastRead = thread?.lastReadThreadSeq;
  useEffect(() => {
    if (status === "ready" && visible) void store.markThreadRead(rootId);
  }, [store, rootId, status, visible, newestReplySeq, lastRead]);

  const messages = useMemo(() => (root ? [root, ...(replies ?? [])] : (replies ?? [])), [root, replies]);
  const senderIds = useMemo(() => [...messages.map((m) => m.sender.id), ...(me ? [me.id] : [])], [messages, me]);
  const avatarUrls = useAvatarUrls(senderIds);
  const attachmentUrls = useMediaState((s) => s.attachments);
  const imageIds = useMemo(() => previewImageIds(messages).join(" "), [messages]);
  useEffect(() => {
    if (imageIds !== "") media.requestAttachmentUrls(imageIds.split(" "));
  }, [media, imageIds]);

  // 本文に貼られたパーマリンクのカード（ADR 0040）。チャンネルと同じストアなので、両方に出ていても 1 回しか取らない
  const origin = useOrigin();
  const permalinks = useMemo(() => (origin ? permalinksIn(messages, origin) : []), [messages, origin]);
  const linkCards = useLinkCards(permalinks);

  const broadcastDoneLabel = room ? alsoInChannelDoneLabel(room.kind) : undefined;
  const items = useMemo(
    () =>
      toThreadTimelineItems(
        { root, replies: replies ?? [] },
        {
          outgoing,
          me,
          avatarUrls,
          attachmentUrls,
          broadcastDoneLabel,
          linkCards,
          origin,
          currentWorkspaceId: workspaceId,
        },
      ),
    [
      root,
      replies,
      outgoing,
      me,
      avatarUrls,
      attachmentUrls,
      broadcastDoneLabel,
      linkCards,
      origin,
      workspaceId,
    ],
  );
  const { timelineProps, deleteDialog } = useMessageActions({ workspaceId, roomId, room, messages, me, myRole, members });
  const draftViews = useMemo(() => drafts.map(toAttachmentDraftView), [drafts]);
  const typingNames = useMemo(() => (typing ?? []).map((t) => t.user.display_name), [typing]);

  if (!room || notThread) return null;

  const canSend =
    (draft.trim() !== "" || drafts.length > 0) && draftsReady(drafts) && [...draft].length <= MAX_BODY_LENGTH;

  function send() {
    if (!canSend) return;
    store.sendMessage(roomId, { body: draft, attachments: uploader.take(), threadRootId: rootId, alsoInChannel });
    setDraft("");
    setAlsoInChannel(false);
    setSentCount((n) => n + 1);
  }

  async function download(attachmentId: string) {
    try {
      startDownload(await media.attachmentDownloadUrl(attachmentId));
    } catch (err) {
      console.error("failed to download an attachment", err);
    }
  }

  async function join() {
    setJoining(true);
    try {
      await store.joinRoom(roomId);
    } catch (err) {
      console.error("failed to join room", err);
    } finally {
      setJoining(false);
    }
  }

  const ready = status === "ready" && root !== null;
  return (
    <>
      <ThreadPanel
        room={{ kind: room.kind, name: roomName(room) }}
        onClose={onClose}
        footer={
          !ready ? undefined : room.kind === "public" && !room.is_member ? (
            <JoinRoomBar joining={joining} onJoin={join} />
          ) : (
            <Composer
              target="thread"
              value={draft}
              onChange={(value) => {
                setDraft(value);
                if (value.trim() !== "") realtime.sendTyping(roomId, rootId);
              }}
              onSend={send}
              canSend={canSend}
              onSelectFiles={(files) => uploader.add(files)}
              attachments={draftViews}
              onRetryAttachment={(key) => uploader.retry(key)}
              onRemoveAttachment={(key) => uploader.remove(key)}
              typingNames={typingNames}
              alsoInChannel={{
                label: alsoInChannelLabel(room.kind),
                checked: alsoInChannel,
                onChange: setAlsoInChannel,
              }}
            />
          )
        }
      >
        {ready && (
          <Timeline
            items={items}
            label="スレッドのメッセージ"
            onReachStart={() => store.loadOlderThread(rootId)}
            scrollToLatestKey={sentCount}
            onRetry={(key) => store.retryMessage(roomId, key)}
            onDiscard={(key) => store.discardMessage(roomId, key)}
            onDownload={download}
            onImageError={(id, url) => media.attachmentImageFailed(id, url)}
            {...timelineProps}
          />
        )}
      </ThreadPanel>
      {deleteDialog}
    </>
  );
}
