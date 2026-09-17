"use client";

import { type ReactNode, createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { getApiBaseUrl } from "@/lib/api-base-url";
import { useSession } from "@/lib/auth/session-provider";

import { createChatApi } from "./api";
import { type SocketLike, webSocketUrl } from "./connection";
import { type Realtime, createRealtime } from "./realtime";
import { type ChatState, type ChatStore, createChatStore } from "./store";

type ChatContextValue = { store: ChatStore; realtime: Realtime };

const ChatContext = createContext<ChatContextValue | null>(null);

/** WebSocket の接続先と作り方。テストでは偽のソケットと、再接続を待たないジッター（random）を渡す。 */
export type RealtimeTransport = { url: string; createSocket: (url: string) => SocketLike; random?: () => number };

function browserTransport(): RealtimeTransport {
  return { url: webSocketUrl(getApiBaseUrl()), createSocket: (url) => new WebSocket(url) };
}

/**
 * チャットの状態と WebSocket の接続を、ログインしている間だけ 1 つ持つ。
 *
 * `(app)` のレイアウトがログイン済みのときだけ置く。ログアウトすると外れて状態ごと捨てられ、接続も閉じるので、
 * 同じタブで別の人がログインしても、前の人のルームやメッセージが残らない。
 */
export function ChatProvider({
  children,
  userId,
  transport,
}: {
  children: ReactNode;
  userId: string;
  transport?: RealtimeTransport;
}) {
  const session = useSession();
  const [value] = useState<ChatContextValue>(() => {
    const api = createChatApi(session.request);
    const store = createChatStore(api, { userId });
    const { url, createSocket, random } = transport ?? browserTransport();
    const realtime = createRealtime({
      store,
      url,
      createSocket,
      random,
      issueTicket: api.issueTicket,
      revalidateSession: () => session.revalidate(),
    });
    return { store, realtime };
  });

  useEffect(() => {
    value.realtime.start();
    return () => {
      value.realtime.stop();
      value.store.dispose();
    };
  }, [value]);

  return <ChatContext value={value}>{children}</ChatContext>;
}

function useChatContext(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error("chat hooks must be used inside ChatProvider");
  return value;
}

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
