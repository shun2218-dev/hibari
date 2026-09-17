"use client";

import { type ReactNode, createContext, useContext, useState, useSyncExternalStore } from "react";

import { useSession } from "@/lib/auth/session-provider";

import { createChatApi } from "./api";
import { type ChatState, type ChatStore, createChatStore } from "./store";

const ChatContext = createContext<ChatStore | null>(null);

/**
 * チャットの状態を、ログインしている間だけ 1 つ持つ。
 *
 * `(app)` のレイアウトがログイン済みのときだけ置く。ログアウトすると外れて状態ごと捨てられるので、
 * 同じタブで別の人がログインしても、前の人のルームやメッセージが残らない。
 */
export function ChatProvider({ children, store: injected }: { children: ReactNode; store?: ChatStore }) {
  const session = useSession();
  const [store] = useState(() => injected ?? createChatStore(createChatApi(session.request)));
  return <ChatContext value={store}>{children}</ChatContext>;
}

export function useChatStore(): ChatStore {
  const store = useContext(ChatContext);
  if (!store) throw new Error("useChatStore must be used inside ChatProvider");
  return store;
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
