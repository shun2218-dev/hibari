"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ArchivedRoomBar,
  EmptyMessages,
  JoinRoomBar,
  MessageNotFoundNotice,
  RemovedFromWorkspace,
  RoomUnavailable,
  UnreadJumpBar,
} from "@/components/chat/chat-states";
import { Composer } from "@/components/chat/composer";
import { ConnectionBanner } from "@/components/chat/connection-banner";
import { ConfirmMentionAllDialog } from "@/components/chat/dialogs/confirm-mention-all";
import { useMessageActions } from "@/hooks/chat/use-message-actions";
import { type ProfileSender, useSenders } from "@/hooks/chat/use-senders";
import { useProfileHoverCard } from "@/hooks/chat/use-profile-hover-card";
import { useRoomNotifications } from "@/hooks/chat/use-room-notifications";
import { RoomPins } from "./room-pins";
import { RoomSettings } from "./room-settings";
import { RoomHeader } from "@/components/chat/room-header";
import { type RoomTab, RoomTabs } from "@/components/chat/room-tabs";
import { Timeline } from "@/components/chat/timeline";
import { useSessionState } from "@/hooks/auth/use-session";
import {
  useAttachmentUploader,
} from "@/hooks/chat/use-attachment-uploader";
import {
  useAvatarUrls,
  useLinkPreviewUrls,
  useMedia,
  useMediaState,
} from "@/hooks/chat/use-media";
import {
  useChatState,
  useChatStore,
  useRealtime,
} from "@/hooks/chat/use-chat-store";
import {
  useLinkCards,
} from "@/hooks/chat/use-link-cards";
import { forgetLocation } from "@/lib/chat/last-location";
import { draftsReady } from "@/lib/chat/media/uploads";
import { mentionAll } from "@/lib/chat/format/mentions";
import { useComposerToolbar } from "@/hooks/use-composer-toolbar";
import { useComposerLinkPreviews } from "@/hooks/chat/use-composer-link-previews";
import { useOrigin } from "@/hooks/use-origin";
import { memberSettings, mentionAllRecipients, toMemberNames, toMentionCandidates } from "@/lib/chat/views/members";
import { permalinksIn, previewImageIds, toAttachmentDraftView } from "@/lib/chat/views/message";
import { canPost, roomArchiveActions } from "@/lib/chat/views/permissions";
import { roomName } from "@/lib/chat/views/rooms";
import { toTimelineItems } from "@/lib/chat/views/timeline";
import { useDocumentVisible } from "@/hooks/use-document-visible";

/** 本文の上限（rune。ADR 0012）。超えたら送信できないようにする（送っても 422 で失敗にしかならない）。 */
const MAX_BODY_LENGTH = 4000;

/** 飛んだ先を強調しておく時間（ADR 0042）。 */
const HIGHLIGHT_MS = 4000;

/** 「ここから未読」の区切りの key（toTimelineItems が付ける）。未読へ飛んだときのスクロールの合わせ先。 */
const UNREAD_DIVIDER_KEY = "unread";

type RoomViewProps = {
  workspaceId: string;
  roomId: string;
  membersOpen: boolean;
  onToggleMembers: () => void;
  onBack: () => void;
  onLeaveRemovedWorkspace: () => void;
  /** スレッドのパネルで開いている親（ADR 0036）。タイムラインで強調する。 */
  openThreadId?: string;
  /** 「返信」か「N 件の返信」、チャンネルに流した返信の「スレッドに返信しました」を押した。親の ID を渡す。 */
  onOpenThread: (rootId: string) => void;
  /** リンク（`?m=`）で指されたメッセージ。そこまで飛んで強調する（ADR 0042）。 */
  jumpMessageId?: string;
  /**
   * 送信者のアバターか名前、メンションを押した（右のプロフィールのパネル。ADR 0050）。
   * sender は一覧にいない人（外された人）の名前の手がかり。
   */
  onOpenProfile: (userId: string, sender: ProfileSender | undefined) => void;
};

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
  openThreadId,
  onOpenThread,
  jumpMessageId,
  onOpenProfile,
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
  const workspaceMembers = useChatState((s) => s.members[workspaceId]);
  const timeline = useChatState((s) => s.timelines[roomId]);
  const banner = useChatState((s) => s.connection.banner);
  const typing = useChatState((s) => s.typing[roomId]);
  const removal = useChatState((s) => s.removedRooms[roomId]);
  const workspaceRemoval = useChatState((s) => s.removedWorkspaces[workspaceId]);
  const [joining, setJoining] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  // 入力欄の本文。ルームごとに作り直すので、別のルームに移ると消える
  const [draft, setDraft] = useState("");
  // 書式のツールバーを出すか。見る人ごとの好みとしてブラウザに覚える（ADR 0052 の追記）
  const [toolbarVisible, setToolbarVisible] = useComposerToolbar();
  const { uploader, drafts } = useAttachmentUploader(roomId);
  // 送る前のリンクのプレビュー（ADR 0065 決定 13）
  const composerLinks = useComposerLinkPreviews(roomId, draft);
  const [sentCount, setSentCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 送る前に確認している `@channel` / `@here`（ADR 0043）。null なら確認していない
  const [confirmAll, setConfirmAll] = useState<"channel" | "here" | null>(null);
  // 飛んできた先（ADR 0042）。強調する key、スクロールの合わせ先、見つからなかったときの知らせ
  const [highlightedKey, setHighlightedKey] = useState<string>();
  const [scrollTo, setScrollTo] = useState<{ key: string; align: "center" | "start" }>();
  const [notFound, setNotFound] = useState(false);
  const visible = useDocumentVisible();
  // ヘッダーの下の「メッセージ / ピン」（ADR 0054 決定 11 の追記）。ルームごとに作り直すので、別のルームでは「メッセージ」から始まる
  const [tab, setTab] = useState<RoomTab>("messages");
  const notifications = useRoomNotifications(workspaceId, roomId);

  useEffect(() => {
    store.openRoom(roomId);
  }, [store, roomId]);

  // `@` の補完にはルームのメンバーが要る（ADR 0043）。メンバーパネルを開かなくても引いておく
  const membersLoaded = members !== undefined;
  useEffect(() => {
    if (!membersLoaded) void store.loadRoomMembers(roomId);
  }, [store, roomId, membersLoaded]);

  /**
   * リンク（`?m=`）で指されたメッセージまで飛ぶ（ADR 0042）。
   *
   * 同じ ID で 2 度は飛ばない（スレッドを開くとクエリが増えるだけで、飛び先は変わらないため）。
   * 見つからなければサーバーは最新のページを返すので、知らせを 1 行出す。スレッドの返信ならパネルも開く。
   */
  const jumpedRef = useRef<string>(undefined);
  useEffect(() => {
    if (jumpMessageId === undefined || jumpedRef.current === jumpMessageId) return;
    jumpedRef.current = jumpMessageId;
    setNotFound(false);
    // ピンのカードから飛んだときも、タイムラインに戻して飛び先を見せる
    setTab("messages");
    void store.jumpToMessage(roomId, jumpMessageId).then(({ found, threadRootId }) => {
      setNotFound(!found);
      if (found) {
        setHighlightedKey(jumpMessageId);
        setScrollTo({ key: jumpMessageId, align: "center" });
      }
      if (threadRootId !== null) onOpenThread(threadRootId);
    });
  }, [store, roomId, jumpMessageId, onOpenThread]);

  // 強調は数秒で消す（ADR 0042）。押しても消える（Timeline の onClearHighlight）
  useEffect(() => {
    if (highlightedKey === undefined) return;
    const timer = setTimeout(() => setHighlightedKey(undefined), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightedKey]);

  // 最新を見ているか（タブが見えていて、いちばん下が見えている）をデータ層に知らせる。見ている間に届いたメッセージは既読になる。
  // 飛んだ先で新しい側が開いている間（hasNewer）は、いちばん下でも最新ではない
  const ready = timeline?.status === "ready";
  const hasNewer = timeline?.hasNewer ?? false;
  useEffect(() => {
    store.setFocus({ roomId, caughtUp: ready && visible && atBottom && !hasNewer });
  }, [store, roomId, ready, visible, atBottom, hasNewer]);
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
  // 一覧にいない人（外された人）のカードとパネルの名前は、メッセージの送信者の値から引く（ADR 0050 決定 5）
  const senderOf = useSenders(messages);
  const profileHoverCardFor = useProfileHoverCard({ workspaceId, senderOf });
  const attachmentUrls = useMediaState((s) => s.attachments);
  const imageIds = useMemo(() => previewImageIds(messages ?? []).join(" "), [messages]);
  useEffect(() => {
    if (imageIds !== "") media.requestAttachmentUrls(imageIds.split(" "));
  }, [media, imageIds]);
  // リンクのプレビューの画像とアイコンも、自前のストレージの署名付き URL を引く（ADR 0065 決定 7）
  const linkPreviewUrls = useLinkPreviewUrls(messages);

  // 本文に貼られたパーマリンクのカード（ADR 0040）。中身は本文に入っていないので、見る人の権限で取り直す
  const origin = useOrigin();
  const permalinks = useMemo(() => (origin ? permalinksIn(messages ?? [], origin) : []), [messages, origin]);
  const linkCards = useLinkCards(permalinks);

  const memberNames = useMemo(() => toMemberNames(members), [members]);
  // リンクのカードは別のルームのメッセージのことが多いので、本文のメンションはワークスペースのメンバーから引く（ADR 0051）
  const workspaceMemberNames = useMemo(() => toMemberNames(workspaceMembers?.list), [workspaceMembers]);
  // 名前の横に出すカスタムステータスは、ワークスペースのメンバー一覧から引く（ADR 0049 決定 7 の追記）
  const statuses = useMemo(() => memberSettings(workspaceMembers?.list), [workspaceMembers]);
  const statusEmojis = useMemo(
    () => Object.fromEntries(Object.entries(statuses).map(([id, member]) => [id, member.status])),
    [statuses],
  );
  const mentionCandidates = useMemo(
    () => toMentionCandidates(members, { kind: room?.kind ?? "public", avatarUrls }),
    [members, room?.kind, avatarUrls],
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
    // 投稿できる人だけがリアクションを付けられる。参加していない public ルームは読めるだけ（ADR 0044 決定 6）、
    // アーカイブ中は誰も付けられない（ADR 0059）
    canReact: room !== undefined && canPost(room),
    // ピン留めも同じ（ADR 0054 決定 4）
    canPin: room !== undefined && canPost(room),
  });

  const items = useMemo(
    () =>
      toTimelineItems(messages ?? [], {
        unreadAfterSeq,
        outgoing,
        me,
        avatarUrls,
        attachmentUrls,
        linkPreviewUrls,
        linkCards,
        origin,
        currentWorkspaceId: workspaceId,
        memberNames,
        workspaceMemberNames,
        statuses: statusEmojis,
      }),
    [
      messages,
      unreadAfterSeq,
      outgoing,
      me,
      avatarUrls,
      attachmentUrls,
      linkPreviewUrls,
      linkCards,
      origin,
      workspaceId,
      memberNames,
      workspaceMemberNames,
      statusEmojis,
    ],
  );
  /**
   * 未読が、読み込んだページより古いところにある（ADR 0042）。そのときだけ「未読 N 件 / 最初の未読へ」を出す。
   * ページの中にあるときは「ここから未読」の線が見えているので、押しても何も起きないボタンになる。
   */
  const unreadBarCount =
    timeline?.status === "ready" &&
    timeline.unreadAfterSeq !== null &&
    timeline.hasOlder &&
    timeline.unreadAtOpen > 0 &&
    (timeline.messages[0]?.seq ?? 0) > timeline.unreadAfterSeq
      ? timeline.unreadAtOpen
      : 0;

  const draftViews = useMemo(() => drafts.map(toAttachmentDraftView), [drafts]);
  const typingNames = useMemo(() => (typing ?? []).map((t) => t.user.display_name), [typing]);

  // ワークスペースから外されたとき（下）は、ワークスペースのお知らせのほうを出す
  if (unavailable && workspaceRemoval?.reason !== "removed") {
    // 名前も人数も見せないので、ヘッダーごと出さない（ADR 0035）
    return <RoomUnavailable onBack={() => router.replace(`/w/${workspaceId}`)} />;
  }
  if (!room || otherWorkspace) return null;

  const findMessage = (key: string) => messages?.find((m) => m.id === key);
  // チャンネルに流した返信（ADR 0039）の行から開くのは、その返信の親のスレッド。それ以外はその行がスレッドの親になる
  const threadRootOf = (key: string) => {
    const message = findMessage(key);
    return message ? (message.thread_root_id ?? message.id) : undefined;
  };
  // 添付があれば本文は空でもよい。アップロード中・失敗した添付が残っていたら送らない（ADR 0013 / 0028）
  const canSend =
    (draft.trim() !== "" || drafts.length > 0) && draftsReady(drafts) && [...draft].length <= MAX_BODY_LENGTH;

  function changeDraft(value: string) {
    setDraft(value);
    if (value.trim() !== "") realtime.sendTyping(roomId);
  }


  /** body は入力欄が Enter で渡す本文（送る直前に手で打った `@ハンドル` をメンションにしたもの）。ボタンなら draft。 */
  function send(body: string = draft) {
    if (!canSend) return;
    // 全員に飛ぶメンションは、送る前に確認する（ADR 0043）
    const all = mentionAll(body);
    if (all !== null) {
      setConfirmAll(all);
      return;
    }
    sendNow(body);
  }

  function sendNow(body: string = draft) {
    store.sendMessage(roomId, { body, attachments: uploader.take(), suppressedLinkPreviewUrls: composerLinks.suppressedUrls() });
    composerLinks.reset();
    setDraft("");
    setConfirmAll(null);
    setSentCount((n) => n + 1);
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

  /** 入力欄の代わりの帯から復元する（ADR 0059。確認は挟まない）。 */
  async function restore() {
    setRestoring(true);
    try {
      await store.unarchiveRoom(roomId);
    } catch (err) {
      // 失敗の表示はデザインにない（参加と同じ）。ボタンを押せる状態に戻す
      console.error("failed to unarchive room", err);
    } finally {
      setRestoring(false);
    }
  }

  const removedFromWorkspace = workspaceRemoval?.reason === "removed";
  const archived = room.archived_at !== null;
  const header = (
    <RoomHeader
      archived={archived}
      kind={room.kind}
      name={roomName(room)}
      memberCount={room.member_count ?? 0}
      membersOpen={membersOpen}
      onToggleMembers={onToggleMembers}
      // DM は設定を変えられない（ADR 0011）。member にも読み取り専用で開ける。
      // ワークスペースから外されたら、もう読めないので出さない
      onOpenSettings={room.kind === "dm" || removedFromWorkspace ? undefined : () => setSettingsOpen(true)}
      // ミュートと通知の設定（ADR 0055）。参加していない public ルームと、外されたワークスペースでは出さない
      notifications={removedFromWorkspace ? undefined : notifications}
      onBack={onBack}
    />
  );

  // ワークスペースから外されたら、ヘッダーは残して本文を差し替える（chat/workspace/removed-from-workspace.png）
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
      <RoomTabs value={tab} onChange={setTab} />
      <ConnectionBanner status={banner} />
      {/* 「ピン」のタブではタイムラインと入力欄の代わりに一覧を出す（Slack と同じ。ADR 0054） */}
      {tab === "pins" && <RoomPins workspaceId={workspaceId} roomId={roomId} onOpen={() => setTab("messages")} />}
      {tab === "messages" && unreadBarCount > 0 && (
        <UnreadJumpBar
          count={unreadBarCount}
          onJump={() => {
            // 読み直したら「ここから未読」の線を上端に出す（そこから下が全部未読。ADR 0042）
            void store.jumpToUnread(roomId).then(() => setScrollTo({ key: UNREAD_DIVIDER_KEY, align: "start" }));
          }}
        />
      )}
      {notFound && <MessageNotFoundNotice onClose={() => setNotFound(false)} />}
      {/* 取得中と、取得できなかったとき（その画面はデザインにない）は、ヘッダーだけを出す */}
      {tab === "messages" &&
        ready &&
        (items.length === 0 ? (
          <EmptyMessages kind={room.kind} name={roomName(room)} />
        ) : (
          <Timeline
            items={items}
            onReachStart={() => store.loadOlder(roomId)}
            onReachEnd={() => store.loadNewer(roomId)}
            scrollToKey={scrollTo?.key}
            scrollToAlign={scrollTo?.align}
            highlightedKey={highlightedKey}
            onClearHighlight={() => setHighlightedKey(undefined)}
            onMarkAllRead={() => store.dismissUnread(roomId)}
            onAtBottomChange={setAtBottom}
            scrollToLatestKey={sentCount}
            onRetry={(key) => store.retryMessage(roomId, key)}
            onDiscard={(key) => store.discardMessage(roomId, key)}
            onImageError={(id, url) => media.attachmentImageFailed(id, url)}
            {...timelineProps}
            // スレッドは確定したメッセージにだけ作れる（送信中のものにはまだ ID がない）。システムメッセージの「返信」は出ない
            onReply={(key) => {
              const rootId = threadRootOf(key);
              if (rootId) onOpenThread(rootId);
            }}
            onOpenThread={(key) => {
              const rootId = threadRootOf(key);
              if (rootId) onOpenThread(rootId);
            }}
            openThreadKey={openThreadId}
            onOpenProfile={(userId) => onOpenProfile(userId, senderOf(userId))}
            profileHoverCardFor={profileHoverCardFor}
          />
        ))}
      {tab !== "messages" ? null : archived ? (
        // アーカイブ中は、入力欄の代わりに帯を出す。復元のボタンは復元できる人にだけ（ADR 0059）
        <ArchivedRoomBar
          restoring={restoring}
          onRestore={roomArchiveActions(room, myRole).canArchive ? restore : undefined}
        />
      ) : room.kind === "public" && !room.is_member ? (
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
            mentionCandidates={mentionCandidates}
            linkPreviews={composerLinks.previews}
            onRemoveLinkPreview={composerLinks.remove}
            toolbarVisible={toolbarVisible}
            onToggleToolbar={setToolbarVisible}
          />
        )
      )}
      {overlays}
      <ConfirmMentionAllDialog
        open={confirmAll !== null}
        kind={confirmAll ?? "channel"}
        memberCount={mentionAllRecipients(members, confirmAll ?? "channel", me?.id)}
        onCancel={() => setConfirmAll(null)}
        onConfirm={() => sendNow()}
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
