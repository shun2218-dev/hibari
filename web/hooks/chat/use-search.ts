"use client";

import { useSyncExternalStore } from "react";

import type { SearchState } from "@/lib/chat/search/search-store";
import type { SearchStore } from "@/lib/chat/search/search-store";

import { useChatContext } from "./use-chat-context";

/** 検索のストア（ADR 0061）。検索を始める・続きを読む・やめる。 */
export function useSearchStore(): SearchStore {
  return useChatContext().search;
}

/** いまの検索の状態。結果は要求した時点のもので、あとから追従しない（決定 8）。 */
export function useSearchState(): SearchState {
  const search = useSearchStore();
  const get = () => search.getSnapshot();
  return useSyncExternalStore(search.subscribe, get, get);
}
