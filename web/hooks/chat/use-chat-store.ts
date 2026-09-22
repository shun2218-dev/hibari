"use client";

import { useSyncExternalStore } from "react";

import type { Realtime } from "@/lib/chat/realtime/subscriptions";
import type { ChatStore } from "@/lib/chat/store/chat-store";
import type { ChatState } from "@/lib/chat/store/state";

import { useChatContext } from "./use-chat-context";

export function useChatStore(): ChatStore {
  return useChatContext().store;
}

export function useRealtime(): Realtime {
  return useChatContext().realtime;
}

/**
 * 状態の一部を購読する。
 *
 * select はストアの中にある値をそのまま返すこと（`s.rooms[id]` など）。その場で配列やオブジェクトを作ると、
 * 毎回違う値になって useSyncExternalStore が描き直しを繰り返す。表示用の変換は useMemo で行う。
 */
export function useChatState<T>(select: (state: ChatState) => T): T {
  const store = useChatStore();
  const get = () => select(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, get, get);
}
