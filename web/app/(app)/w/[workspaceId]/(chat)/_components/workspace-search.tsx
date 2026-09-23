"use client";

import { useEffect, useMemo, useState } from "react";

import { type RoomOption, SearchFiltersDialog } from "@/components/chat/dialogs/search-filters";
import { type SearchFilterKey, SearchResults } from "@/components/chat/search-results";
import { useChatState } from "@/hooks/chat/use-chat-store";
import { useAvatarUrls } from "@/hooks/chat/use-media";
import { useSearchState, useSearchStore } from "@/hooks/chat/use-search";
import {
  dateChoiceOf,
  dateRangeOf,
  type SearchDateChoice,
  type SearchQuery,
} from "@/lib/chat/search/search-query";
import { toMemberNames } from "@/lib/chat/views/members";
import { toSearchResultView } from "@/lib/chat/views/search";

/**
 * 検索結果の画面（ADR 0061）。サイドバーを畳んだメインの領域に出す。
 *
 * 条件は URL（`?q=`）が正で、ここは受け取った条件で検索するだけ。フィルターのダイアログを触ったら
 * `onChangeQuery` で URL を書き換え、その結果またここに新しい条件が降ってくる。
 * 入力欄の修飾子も同じ条件を書き換えるので、2 つの入り口が 1 つの状態に繋がる（決定 5）。
 */
export function WorkspaceSearch({
  workspaceId,
  query,
  side,
  onChangeQuery,
}: {
  workspaceId: string;
  query: SearchQuery;
  /** 結果を押したときの行き先に残す左のメニュー（ADR 0058 決定 1）。 */
  side: string;
  onChangeQuery: (query: SearchQuery) => void;
}) {
  const search = useSearchStore();
  const { results, terms, status } = useSearchState();
  const roomList = useChatState((s) => s.roomLists[workspaceId]);
  const rooms = useChatState((s) => s.rooms);
  const members = useChatState((s) => s.members[workspaceId]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [senderQuery, setSenderQuery] = useState("");
  const [roomQuery, setRoomQuery] = useState("");
  // 「今日」は描くたびに作らない（日付のチップの文言と、選択肢の範囲がその場で変わらないように）
  const [today] = useState(() => localToday());

  // 条件が変わるたびに検索し直す。URL を直接開いてもここで走る
  const key = JSON.stringify(query);
  useEffect(() => {
    void search.run(workspaceId, JSON.parse(key) as SearchQuery);
  }, [search, workspaceId, key]);

  const senderIds = useMemo(() => results.map((r) => r.sender.id), [results]);
  const avatarUrls = useAvatarUrls(senderIds);
  const memberNames = useMemo(() => toMemberNames(members?.list), [members]);
  const views = useMemo(() => {
    const now = new Date();
    return results.map((r) => toSearchResultView(r, workspaceId, { now, avatarUrls, memberNames, side }));
  }, [results, workspaceId, avatarUrls, memberNames, side]);

  // フィルターのダイアログの候補。打った文字で絞る（名前 → ID の解決はここでしか行わない。決定 5）
  const roomOptions: RoomOption[] = useMemo(() => {
    const all = (roomList?.ids ?? []).flatMap((id) => {
      const room = rooms[id];
      if (!room) return [];
      const name = room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : (room.name ?? "");
      return name === "" ? [] : [{ id: room.id, kind: room.kind, name }];
    });
    return matches(all, roomQuery);
  }, [roomList, rooms, roomQuery]);
  const senderOptions = useMemo(
    () => matches((members?.list ?? []).map((m) => ({ id: m.user.id, name: m.user.display_name })), senderQuery),
    [members, senderQuery],
  );

  function clearFilter(key: SearchFilterKey) {
    const next = { ...query };
    if (key === "sender") delete next.sender;
    if (key === "room") delete next.room;
    if (key === "date") {
      delete next.after;
      delete next.before;
    }
    onChangeQuery(next);
  }

  function changeDate(choice: SearchDateChoice) {
    const { after, before } = dateRangeOf(choice, today);
    const next = { ...query };
    delete next.after;
    delete next.before;
    onChangeQuery({ ...next, ...(after ? { after } : {}), ...(before ? { before } : {}) });
  }

  return (
    <>
      <SearchResults
        query={query.text}
        filters={query}
        today={today}
        // 取得中は何も並べない（0 件の表示と取り違えないように。ほかの一覧と同じ）
        results={status === "ready" ? views : undefined}
        highlightTerms={terms}
        onOpenFilters={() => setFiltersOpen(true)}
        onClearFilter={clearFilter}
        onReachEnd={() => void search.loadMore(workspaceId)}
      />
      <SearchFiltersDialog
        open={filtersOpen}
        filters={query}
        senderQuery={senderQuery}
        senderOptions={senderOptions}
        roomQuery={roomQuery}
        roomOptions={roomOptions}
        date={dateChoiceOf(query, today)}
        onChangeSenderQuery={setSenderQuery}
        onSelectSender={(user) => onChangeQuery({ ...query, sender: { id: user.id, name: user.name } })}
        onChangeRoomQuery={setRoomQuery}
        onSelectRoom={(room) => onChangeQuery({ ...query, room })}
        onChangeDate={changeDate}
        onClear={() => onChangeQuery({ text: query.text })}
        onClose={() => setFiltersOpen(false)}
        onSubmit={() => setFiltersOpen(false)}
      />
    </>
  );
}

/** 打った文字を含むものを、多くても 5 件だけ出す（ダイアログが縦に伸びないように）。 */
function matches<T extends { name: string }>(all: T[], query: string): T[] {
  const needle = query.trim().replace(/^[#@]/, "");
  if (needle === "") return [];
  return all.filter((item) => item.name.includes(needle)).slice(0, 5);
}

/** 端末の今日（`YYYY-MM-DD`）。日付の選択肢と、チップの文言に使う。 */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
