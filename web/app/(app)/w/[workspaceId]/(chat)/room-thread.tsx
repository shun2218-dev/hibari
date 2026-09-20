"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { JoinRoomBar } from "@/components/chat/chat-states";
import { Composer } from "@/components/chat/composer";
import { ConfirmMentionAllDialog } from "@/components/chat/room-dialogs";
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
import { mentionAll, toWireBody } from "@/lib/chat/mentions";
import { draftsReady } from "@/lib/chat/uploads";
import { useOrigin } from "@/lib/chat/use-origin";
import {
  alsoInChannelDoneLabel,
  alsoInChannelLabel,
  mentionAllRecipients,
  permalinksIn,
  previewImageIds,
  roomName,
  toAttachmentDraftView,
  toMemberNames,
  toMentionCandidates,
  toThreadTimelineItems,
} from "@/lib/chat/views";
import { useDocumentVisible } from "@/lib/use-document-visible";

import { useMessageActions } from "./message-actions";

/** 本文の上限（rune。ADR 0012）。チャンネルの入力欄と同じ。 */
const MAX_BODY_LENGTH = 4000;

/** 飛んだ先を強調しておく時間（ADR 0042）。チャンネルと同じ。 */
const HIGHLIGHT_MS = 4000;

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
  jumpMessageId,
  onClose,
}: {
  workspaceId: string;
  roomId: string;
  rootId: string;
  /** リンク（`?m=`）で指された返信。パネルの中でもそこまで飛んで強調する（ADR 0042）。 */
  jumpMessageId?: string;
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
  // 送る前に確認している `@channel` / `@here`（ADR 0043）。スレッドでは「チャンネルにも投稿する」を付けたときだけ使う
  const [confirmAll, setConfirmAll] = useState<"channel" | "here" | null>(null);
  // リンクで飛んできた返信（ADR 0042）。数秒だけ強調する
  const [highlightedKey, setHighlightedKey] = useState<string>();
  const { uploader, drafts } = useAttachmentUploader(roomId);

  // `@` の補完にはルームのメンバーが要る（ADR 0043）。スレッドだけを開いた URL でも引いておく
  const membersLoaded = members !== undefined;
  useEffect(() => {
    if (!membersLoaded) void store.loadRoomMembers(roomId);
  }, [store, roomId, membersLoaded]);

  useEffect(() => {
    void store.openThread(roomId, rootId);
    store.setThreadFocus({ roomId, rootId });
    return () => store.setThreadFocus(null);
  }, [store, roomId, rootId]);

  /**
   * リンクで指された返信まで、パネルの中でも飛ぶ（ADR 0042）。同じ ID で 2 度は飛ばない。
   * 親そのものを指すリンクでは、親はいつもパネルの先頭にいるので、飛ばずに強調だけする。
   */
  const jumpedRef = useRef<string>(undefined);
  useEffect(() => {
    if (jumpMessageId === undefined || jumpedRef.current === jumpMessageId) return;
    jumpedRef.current = jumpMessageId;
    // 親はいつもパネルの先頭にいるので、取り直さずに強調だけする
    const jumping =
      jumpMessageId === rootId
        ? Promise.resolve({ found: true })
        : store.jumpToThreadMessage(roomId, rootId, jumpMessageId);
    void jumping.then(({ found }) => {
      if (found) setHighlightedKey(jumpMessageId);
    });
  }, [store, roomId, rootId, jumpMessageId]);

  useEffect(() => {
    if (highlightedKey === undefined) return;
    const timer = setTimeout(() => setHighlightedKey(undefined), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightedKey]);

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
  const memberNames = useMemo(() => toMemberNames(members), [members]);
  const mentionCandidates = useMemo(
    () => toMentionCandidates(members, { kind: room?.kind ?? "public", avatarUrls }),
    [members, room?.kind, avatarUrls],
  );
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
          memberNames,
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
      memberNames,
    ],
  );
  const { timelineProps, overlays } = useMessageActions({
    workspaceId,
    roomId,
    room,
    messages,
    me,
    myRole,
    members,
    mentionCandidates,
    // 投稿できる人だけがリアクションを付けられる。参加していない public ルームは読めるだけ（ADR 0044 決定 6）
    canReact: room !== undefined && (room.kind !== "public" || room.is_member),
  });
  const draftViews = useMemo(() => drafts.map(toAttachmentDraftView), [drafts]);
  const typingNames = useMemo(() => (typing ?? []).map((t) => t.user.display_name), [typing]);

  if (!room || notThread) return null;

  const canSend =
    (draft.trim() !== "" || drafts.length > 0) && draftsReady(drafts) && [...draft].length <= MAX_BODY_LENGTH;

  /** 入力欄の `@ハンドル` を保存する形に直す（ADR 0043）。解決できないハンドルはそのまま残る */
  function wireBody() {
    return toWireBody(draft, mentionCandidates);
  }

  function send() {
    if (!canSend) return;
    // スレッドだけの返信では `@channel` / `@here` は誰にも飛ばない（ADR 0041）ので、確認も出さない。
    // 「チャンネルにも投稿する」を付けた返信はルームの全員に飛ぶので、チャンネルの投稿と同じように確認する
    const all = alsoInChannel ? mentionAll(wireBody()) : null;
    if (all !== null) {
      setConfirmAll(all);
      return;
    }
    sendNow();
  }

  function sendNow() {
    store.sendMessage(roomId, { body: wireBody(), attachments: uploader.take(), threadRootId: rootId, alsoInChannel });
    setDraft("");
    setAlsoInChannel(false);
    setConfirmAll(null);
    setSentCount((n) => n + 1);
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
              mentionCandidates={mentionCandidates}
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
            onReachEnd={() => store.loadNewerThread(rootId)}
            scrollToKey={highlightedKey}

            highlightedKey={highlightedKey}
            onClearHighlight={() => setHighlightedKey(undefined)}
            scrollToLatestKey={sentCount}
            onRetry={(key) => store.retryMessage(roomId, key)}
            onDiscard={(key) => store.discardMessage(roomId, key)}
            onImageError={(id, url) => media.attachmentImageFailed(id, url)}
            {...timelineProps}
          />
        )}
      </ThreadPanel>
      {overlays}
      <ConfirmMentionAllDialog
        open={confirmAll !== null}
        kind={confirmAll ?? "channel"}
        memberCount={mentionAllRecipients(members, confirmAll ?? "channel", me?.id)}
        onCancel={() => setConfirmAll(null)}
        onConfirm={sendNow}
      />
    </>
  );
}
