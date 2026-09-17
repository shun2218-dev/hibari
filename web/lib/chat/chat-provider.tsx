"use client";

import { type ReactNode, createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { getApiBaseUrl } from "@/lib/api-base-url";
import { useSession } from "@/lib/auth/session-provider";

import { createChatApi } from "./api";
import { type SocketLike, webSocketUrl } from "./connection";
import { type MediaState, type MediaStore, createMediaStore } from "./media";
import { type Realtime, createRealtime } from "./realtime";
import { type ChatState, type ChatStore, createChatStore } from "./store";
import { type AttachmentDraft, type AttachmentUploader, type UploaderOptions, createAttachmentUploader } from "./uploads";

type ChatContextValue = {
  store: ChatStore;
  realtime: Realtime;
  media: MediaStore;
  createUploader: (roomId: string) => AttachmentUploader;
};

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
  upload,
}: {
  children: ReactNode;
  userId: string;
  transport?: RealtimeTransport;
  /** ストレージへの PUT と画像の寸法の読み取り。テストでは XMLHttpRequest と createImageBitmap の代わりを渡す。 */
  upload?: UploaderOptions;
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
    const media = createMediaStore(api);
    return { store, realtime, media, createUploader: (roomId) => createAttachmentUploader(api, roomId, upload) };
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

export function useMedia(): MediaStore {
  return useChatContext().media;
}

/** 画像の URL の一部を購読する。select の決まりは useChatState と同じ。 */
export function useMediaState<T>(select: (state: MediaState) => T): T {
  const media = useMedia();
  const get = () => select(media.getSnapshot());
  return useSyncExternalStore(media.subscribe, get, get);
}

/**
 * 画面に出すユーザーのアバターの URL を頼み、user_id → URL の表を返す。
 * ID の並びや重複が違うだけなら頼み直さない。
 */
export function useAvatarUrls(userIds: readonly string[]): MediaState["avatars"] {
  const media = useMedia();
  const key = [...new Set(userIds)].sort().join(" ");
  useEffect(() => {
    if (key !== "") media.requestAvatars(key.split(" "));
  }, [media, key]);
  return useMediaState((s) => s.avatars);
}

/**
 * ルームの入力欄の添付。ルームの画面を開いている間だけ持ち、離れたら進行中のアップロードを打ち切る。
 */
export function useAttachmentUploader(roomId: string): { uploader: AttachmentUploader; drafts: AttachmentDraft[] } {
  const { createUploader } = useChatContext();
  const [uploader] = useState(() => createUploader(roomId));
  useEffect(() => () => uploader.abortAll(), [uploader]);
  const drafts = useSyncExternalStore(uploader.subscribe, uploader.getSnapshot, uploader.getSnapshot);
  return { uploader, drafts };
}
