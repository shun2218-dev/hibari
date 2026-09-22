"use client";

import { useEffect, useMemo, useState } from "react";

import { ActivityList } from "@/components/chat/activity-list";
import { DmList } from "@/components/chat/dm-list";
import { RemoveSavedItemDialog } from "@/components/chat/room-dialogs";
import { SavedList } from "@/components/chat/saved-list";
import type { SavedTab } from "@/components/chat/types";
import { useChatState, useChatStore } from "@/hooks/chat/use-chat-store";
import { useAvatarUrls } from "@/hooks/chat/use-media";
import type { ActivityFilter } from "@/lib/api/types.gen";
import { withSide } from "@/lib/chat/format/links";
import { activityListKey } from "@/lib/chat/store/activity-feed";
import { memberSettings, toActivityItemView, toMemberNames, toRoomSummaryView, toSavedItemView } from "@/lib/chat/views/views";

/**
 * 左のメニューの DM・アクティビティ・後で（ADR 0058）。サイドバーの列に出す形（pane）と、左のメニューにポインタを
 * 乗せたときに重ねて出す形（preview）の 2 つで使う。
 *
 * linkSide は、1 件を押したときの行き先に残す左のメニュー。サイドバーの列では自分のメニュー（押してもサイドバーはそのまま）、
 * 重ねた一覧では今のメニュー（押しても今のサイドバーのまま。ADR 0058 の追記）。
 */
type PaneProps = { workspaceId: string; variant: "pane" | "preview"; linkSide: string };

/** アクティビティ。preview はタブを出さず「すべて」だけ。「未読メッセージ」は形ごとの状態で、URL には持たない。 */
export function ActivityPane({ workspaceId, variant, linkSide }: PaneProps) {
  const store = useChatStore();
  const [tab, setTab] = useState<ActivityFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const filter = variant === "preview" ? "all" : tab;
  const list = useChatState((s) => s.activity[workspaceId]?.lists[activityListKey(filter, unreadOnly)]);
  const workspaceMembers = useChatState((s) => s.members[workspaceId]);

  useEffect(() => {
    void store.loadActivity(workspaceId, filter, unreadOnly);
  }, [store, workspaceId, filter, unreadOnly]);

  const items = list?.items;
  const actorIds = useMemo(() => (items ?? []).map((i) => (i.reaction?.user ?? i.message.sender).id), [items]);
  const avatarUrls = useAvatarUrls(actorIds);
  // 本文のメンションは、ワークスペースのメンバーから名前を引く（別のルームのメッセージが並ぶため）
  const memberNames = useMemo(() => toMemberNames(workspaceMembers?.list), [workspaceMembers]);
  const views = useMemo(() => {
    const now = new Date();
    return (items ?? []).map((item) => toActivityItemView(item, { workspaceId, now, avatarUrls, memberNames, side: linkSide }));
  }, [items, workspaceId, avatarUrls, memberNames, linkSide]);

  return (
    <ActivityList
      variant={variant}
      filter={filter}
      onChangeFilter={setTab}
      unreadOnly={unreadOnly}
      onToggleUnreadOnly={() => setUnreadOnly((on) => !on)}
      // 取得中と失敗の画面はデザインにない。取れるまでは何も並べない（0 件の表示と取り違えないように）
      items={list?.status === "ready" ? views : undefined}
      onReachEnd={() => void store.loadMoreActivity(workspaceId, filter, unreadOnly)}
    />
  );
}

/**
 * DM の一覧（決定 7）。ルーム一覧にある DM を、最後のメッセージの新しい順に並べる。サーバーには新しい API を足していない。
 * 「未読メッセージ」は手元のルーム一覧を未読で絞るだけ。
 */
export function DmPane({ workspaceId, variant, linkSide, onStartDm }: PaneProps & { onStartDm?: () => void }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const roomList = useChatState((s) => s.roomLists[workspaceId]);
  const rooms = useChatState((s) => s.rooms);
  const members = useChatState((s) => s.members[workspaceId]);
  const dms = useMemo(
    () =>
      (roomList?.ids ?? [])
        .flatMap((id) => (rooms[id]?.kind === "dm" ? [rooms[id]] : []))
        .sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")),
    [roomList, rooms],
  );
  const peerIds = useMemo(() => dms.flatMap((r) => (r.dm_peer ? [r.dm_peer.id] : [])), [dms]);
  const avatarUrls = useAvatarUrls(peerIds);
  const memberTable = useMemo(() => memberSettings(members?.list), [members]);
  const views = useMemo(() => {
    const now = new Date();
    return dms
      .filter((room) => !unreadOnly || room.unread_count > 0)
      .map((room) => toRoomSummaryView(room, now, { avatarUrls, members: memberTable }));
  }, [dms, unreadOnly, avatarUrls, memberTable]);

  return (
    <DmList
      variant={variant}
      rooms={views}
      roomHref={(id) => withSide(`/w/${workspaceId}/r/${id}`, linkSide)}
      onStartDm={onStartDm}
      unreadOnly={unreadOnly}
      onToggleUnreadOnly={() => setUnreadOnly((on) => !on)}
    />
  );
}

/**
 * 「後で」（ADR 0054）。サイドバーの列に移した（ADR 0058 決定 1）。preview はタブを出さず「進行中」だけ。
 * 行を押すと、そのメッセージへ飛ぶ（ADR 0042）。タブは画面の中の状態で、URL には持たない。
 */
export function LaterPane({ workspaceId, variant, linkSide }: PaneProps) {
  const store = useChatStore();
  const [chosenTab, setTab] = useState<SavedTab>("in_progress");
  const tab = variant === "preview" ? "in_progress" : chosenTab;
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  // 読めない行を押して、外すかどうかを確かめている保存（Slack と同じ流れ）
  const [confirming, setConfirming] = useState<{ messageId: string; pending: boolean } | null>(null);
  const saved = useChatState((s) => s.saved[workspaceId]);
  const current = saved?.tabs[tab];
  const workspaceMembers = useChatState((s) => s.members[workspaceId]);

  useEffect(() => {
    void store.loadSaved(workspaceId, tab);
  }, [store, workspaceId, tab]);

  const items = current?.items;
  const senderIds = useMemo(() => (items ?? []).flatMap((i) => (i.message ? [i.message.sender.id] : [])), [items]);
  const avatarUrls = useAvatarUrls(senderIds);
  const memberNames = useMemo(() => toMemberNames(workspaceMembers?.list), [workspaceMembers]);
  const views = useMemo(() => {
    const now = new Date();
    return (items ?? []).map((item) => toSavedItemView(item, { now, avatarUrls, memberNames, side: linkSide }));
  }, [items, avatarUrls, memberNames, linkSide]);

  function report(action: string) {
    return (err: unknown) => console.error(`failed to ${action} a saved message`, err);
  }

  async function confirmRemove() {
    if (!confirming) return;
    setConfirming({ ...confirming, pending: true });
    try {
      await store.removeSaved(workspaceId, confirming.messageId);
      setConfirming(null);
    } catch (err) {
      // 失敗の表示はデザインにない。押し直せるように戻す
      report("remove")(err);
      setConfirming((c) => c && { ...c, pending: false });
    }
  }

  return (
    <>
      <SavedList
        variant={variant}
        tab={tab}
        onChangeTab={(next) => {
          setOpenMenuKey(undefined);
          setTab(next);
        }}
        inProgressCount={saved?.inProgressCount ?? 0}
        items={current?.status === "ready" ? views : undefined}
        onMove={(key, to) => {
          setOpenMenuKey(undefined);
          void store.moveSaved(workspaceId, key, to).catch(report("move"));
        }}
        onRemove={(key) => {
          setOpenMenuKey(undefined);
          void store.removeSaved(workspaceId, key).catch(report("remove"));
        }}
        onSelectUnavailable={(key) => setConfirming({ messageId: key, pending: false })}
        openMenuKey={openMenuKey}
        onToggleMenu={(key) => setOpenMenuKey((open) => (open === key ? undefined : key))}
        onReachEnd={() => void store.loadMoreSaved(workspaceId, tab)}
      />
      <RemoveSavedItemDialog
        open={confirming !== null}
        pending={confirming?.pending}
        onCancel={() => setConfirming(null)}
        onConfirm={confirmRemove}
      />
    </>
  );
}
