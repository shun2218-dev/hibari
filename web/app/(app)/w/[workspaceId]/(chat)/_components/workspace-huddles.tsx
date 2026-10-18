"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { HuddleList, type HuddleListFilterKey } from "@/components/chat/huddle-list";
import type { HuddleListScope } from "@/components/chat/types";
import { useSessionState } from "@/hooks/auth/use-session";
import { useChatContext } from "@/hooks/chat/use-chat-context";
import { useChatState, useChatStore } from "@/hooks/chat/use-chat-store";
import { useHuddle } from "@/hooks/chat/use-huddle";
import { useAvatarUrls } from "@/hooks/chat/use-media";
import { useRecentHuddles } from "@/hooks/chat/use-recent-huddles";
import { useOrigin } from "@/hooks/use-origin";
import { buildHuddleLink } from "@/lib/chat/format/links";
import {
  toHuddleListItemView,
  toHuddleOngoingCards,
  toHuddlePlaceOptions,
  toHuddleSuggestionView,
} from "@/lib/chat/views/huddles";
import { toDmCandidates, toMemberNames } from "@/lib/chat/views/members";
import { canPost } from "@/lib/chat/views/permissions";

import { NewHuddle } from "./new-huddle";

/** 「コピーしました」を出しておく時間（メッセージの「リンクをコピー」と同じ）。 */
const COPIED_LABEL_MS = 2_000;
/** 進行中のカードの経過時間を描き直す間隔。 */
const TICK_MS = 30_000;

/**
 * ハドルの一覧（`/w/{id}/huddles`。ADR 0067 決定 6〜8。chat/huddle/list.png）。サイドバーの「ハドルミーティング」から開き、メインの領域に出す。
 *
 * 進行中のカードはストアのルームの状態から、「最近のハドルミーティング」と提案のカードは API から描く。
 */
export function WorkspaceHuddles({ workspaceId, onBack }: { workspaceId: string; onBack: () => void }) {
  const store = useChatStore();
  const router = useRouter();
  const huddle = useHuddle();
  const origin = useOrigin();
  const { recentHuddles } = useChatContext();
  const enabled = useChatState((s) => s.features?.huddles ?? false) && huddle !== null;
  const { state: sessionState } = useSessionState();
  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;

  const [scope, setScope] = useState<HuddleListScope>("all");
  const [personId, setPersonId] = useState<string>();
  const [placeId, setPlaceId] = useState<string>();
  const [openFilter, setOpenFilter] = useState<HuddleListFilterKey>();
  const [filterQuery, setFilterQuery] = useState("");
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  const [participantsKey, setParticipantsKey] = useState<string>();
  const [copiedKey, setCopiedKey] = useState<string>();
  const [newOpen, setNewOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // 進行中のカードの経過時間（「数秒」「12 分」）を描き直す
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (copiedKey === undefined) return;
    const timer = setTimeout(() => setCopiedKey(undefined), COPIED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [copiedKey]);
  // 相手の絞り込みの候補に、ワークスペースのメンバーを使う
  useEffect(() => {
    store.loadMembers(workspaceId);
  }, [store, workspaceId]);

  const recent = useRecentHuddles(workspaceId, { filter: scope, participantId: personId, roomId: placeId });
  const roomList = useChatState((s) => s.roomLists[workspaceId]);
  const rooms = useChatState((s) => s.rooms);
  const workspaceRooms = useMemo(() => (roomList?.ids ?? []).flatMap((id) => (rooms[id] ? [rooms[id]] : [])), [roomList, rooms]);
  const members = useChatState((s) => s.members[workspaceId]);
  const names = useMemo(() => toMemberNames(members?.list), [members]);
  const personOptions = useMemo(
    () => toDmCandidates(members?.list ?? [], { userId: me?.id ?? "", search: openFilter === "person" ? filterQuery : "" }),
    [members, me, openFilter, filterQuery],
  );

  const userIds = useMemo(
    () => [
      ...recent.items.flatMap((h) => h.participant_ids),
      ...(recent.suggestions ?? []).flatMap((s) => s.participant_ids),
      ...workspaceRooms.flatMap((r) => r.huddle?.participants.map((p) => p.user_id) ?? []),
      ...personOptions.map((p) => p.id),
    ],
    [recent, workspaceRooms, personOptions],
  );
  const avatarUrls = useAvatarUrls(userIds);

  const ongoing = useMemo(
    () => (enabled ? toHuddleOngoingCards(workspaceRooms, { meId: me?.id, names, avatarUrls, now, canJoin: canPost }) : []),
    [enabled, workspaceRooms, me, names, avatarUrls, now],
  );
  const suggestions = useMemo(
    () => (enabled ? (recent.suggestions ?? []).map((s) => toHuddleSuggestionView(s, { names, avatarUrls })) : []),
    [enabled, recent.suggestions, names, avatarUrls],
  );
  // 絞り込みを変えた直後（前の条件の行を捨てた）は取得中にする。同じ条件の取り直しは今の行を残す
  const items = useMemo(
    () =>
      recent.status === "loading" && recent.items.length === 0
        ? undefined
        : recent.items.map((h) => toHuddleListItemView(h, { workspaceId, meId: me?.id, names, avatarUrls, now })),
    [recent, workspaceId, me, names, avatarUrls, now],
  );

  const person = personId ? personOptions.find((p) => p.id === personId) ?? { id: personId, name: names[personId] ?? "メンバー" } : undefined;
  const placeOptions = toHuddlePlaceOptions(workspaceRooms, openFilter === "place" ? filterQuery : "");
  const place = placeId ? toHuddlePlaceOptions(workspaceRooms, "").find((o) => o.id === placeId) : undefined;
  const findItem = (key: string) => recent.items.find((h) => h.id === key);
  const closeFilter = () => {
    setOpenFilter(undefined);
    setFilterQuery("");
  };

  return (
    <>
      <HuddleList
        ongoing={ongoing}
        suggestions={suggestions}
        scope={scope}
        person={person && { ...person, avatarUrl: avatarUrls[person.id] ?? undefined }}
        place={place}
        items={items}
        loadingMore={recent.loadingMore}
        onReachEnd={() => void recentHuddles.loadMore()}
        onNew={enabled ? () => setNewOpen(true) : undefined}
        // 押した操作の中でプレビューを出す（別のタブを開けるように）。入っていれば、そのハドルの画面を前に出す
        onJoin={(roomId) => huddle?.surface.start(roomId)}
        onShowScreen={() => huddle?.surface.show()}
        onStart={(roomId) => huddle?.surface.start(roomId)}
        openFilter={openFilter}
        onToggleFilter={(filter) => {
          setFilterQuery("");
          setOpenFilter((current) => (current === filter ? undefined : filter));
        }}
        onChangeScope={(value) => {
          setScope(value);
          closeFilter();
        }}
        filterQuery={filterQuery}
        onFilterQueryChange={setFilterQuery}
        personOptions={personOptions.map((p) => ({ id: p.id, name: p.name, avatarUrl: avatarUrls[p.id] ?? undefined }))}
        placeOptions={placeOptions}
        onSelectPerson={(id) => {
          setPersonId(id);
          closeFilter();
        }}
        onSelectPlace={(id) => {
          setPlaceId(id);
          closeFilter();
        }}
        openMenuKey={openMenuKey}
        onToggleMenu={(key) => setOpenMenuKey((current) => (current === key ? undefined : key))}
        participantsKey={participantsKey}
        onShowParticipants={(key) => {
          setOpenMenuKey(undefined);
          setParticipantsKey(key);
        }}
        onOpenProfile={(userId) => {
          setParticipantsKey(undefined);
          router.push(`/w/${workspaceId}/huddles?p=${encodeURIComponent(userId)}`);
        }}
        onToggleSave={(key) => {
          setOpenMenuKey(undefined);
          const item = findItem(key);
          if (!item) return;
          // 印は手元で先に変え、失敗したら戻す（メッセージのホバーの「後で」と同じ）
          recentHuddles.markSaved(key, !item.saved);
          const done = item.saved ? store.removeSaved(workspaceId, item.message_id) : store.saveMessage(item.room.id, item.message_id);
          void done.catch((err: unknown) => {
            console.error("failed to toggle a saved huddle", err);
            recentHuddles.markSaved(key, item.saved);
          });
        }}
        onCopyLink={async (key) => {
          const item = findItem(key);
          if (!item || origin === undefined) return;
          try {
            await navigator.clipboard.writeText(buildHuddleLink(origin, { workspaceId, roomId: item.room.id }));
            setCopiedKey(key);
          } catch (err) {
            console.error("failed to copy a huddle link", err);
          }
        }}
        copiedKey={copiedKey}
        onBack={onBack}
      />
      <NewHuddle workspaceId={workspaceId} open={newOpen} onClose={() => setNewOpen(false)} />
    </>
  );
}
