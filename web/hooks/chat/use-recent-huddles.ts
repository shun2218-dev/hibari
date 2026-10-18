"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import type { RecentHuddlesQuery, RecentHuddlesState } from "@/lib/chat/huddle/recent";

import { useChatContext } from "./use-chat-context";
import { useChatState } from "./use-chat-store";

/**
 * ハドルの一覧の「最近のハドルミーティング」と提案のカード（ADR 0067 決定 6・7）。
 * 開いたとき・絞り込みを変えたときに 1 ページ目を取る。**そのワークスペースのハドルが終わったら取り直す**
 * （一覧のためのイベントはない。進行中だったハドルは、終わってから「最近」に入る）。
 */
export function useRecentHuddles(workspaceId: string, query: RecentHuddlesQuery): RecentHuddlesState {
  const { recentHuddles } = useChatContext();
  const key = JSON.stringify(query);

  useEffect(() => {
    recentHuddles.load(workspaceId, JSON.parse(key) as RecentHuddlesQuery);
  }, [recentHuddles, workspaceId, key]);
  useEffect(() => {
    void recentHuddles.loadSuggestions(workspaceId);
  }, [recentHuddles, workspaceId]);

  // いま進行中のハドルの ID の並び（huddle.updated で変わる）。どれかが消えたら、終わったので取り直す
  const active = useChatState((s) =>
    Object.values(s.rooms)
      .filter((r) => r?.workspace_id === workspaceId && r.huddle !== null)
      .map((r) => r!.huddle!.id)
      .sort()
      .join(" "),
  );
  const previous = useRef(active);
  useEffect(() => {
    const before = previous.current === "" ? [] : previous.current.split(" ");
    previous.current = active;
    const now = new Set(active.split(" "));
    if (before.some((id) => !now.has(id))) {
      recentHuddles.load(workspaceId, JSON.parse(key) as RecentHuddlesQuery);
      void recentHuddles.loadSuggestions(workspaceId);
    }
  }, [active, recentHuddles, workspaceId, key]);

  const get = () => recentHuddles.getSnapshot();
  return useSyncExternalStore(recentHuddles.subscribe, get, get);
}
