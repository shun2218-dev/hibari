"use client";

import { type ReactNode, createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import type { ServerEvent } from "@/lib/api/types.gen";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { useSession } from "@/lib/auth/session-provider";
import { soundEnabled } from "@/lib/notification-prefs";
import { ulid } from "@/lib/ulid";

import { watchWindowInput, watchWindowVisibility, windowVisible } from "./activity";
import { createChatApi } from "./api";
import { type SocketLike, webSocketUrl } from "./connection";
import { type LinkCardState, type LinkCardStore, createLinkCardStore } from "./link-cards";
import { type LinkTarget, linkKey, parseLinkKey } from "./links";
import { type MediaState, type MediaStore, createMediaStore } from "./media";
import { notificationContent, shouldNotify } from "./desktop-notification";
import { type DesktopNotifier, createChime, createDesktopNotifier } from "./desktop-notifier";
import { type Realtime, createRealtime } from "./realtime";
import { type ChatState, type ChatStore, createChatStore } from "./store";
import { type AttachmentDraft, type AttachmentUploader, type UploaderOptions, createAttachmentUploader } from "./uploads";

type ChatContextValue = {
  store: ChatStore;
  realtime: Realtime;
  /**
   * ブラウザ通知（ADR 0057）。押したときの移動は画面（ルーター）が決めるので、あとから setOpen で渡す。
   * テストや Notification のない環境では null。
   */
  desktop: { notifier: DesktopNotifier; setOpen: (open: (url: string) => void) => void } | null;
  media: MediaStore;
  linkCards: LinkCardStore;
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
    // 偽のソケットで描くテストでは、ブラウザ通知の係を作らない（本物の Notification と Web Locks を使うため）
    const desktop = transport ? null : createDesktop();
    const realtime = createRealtime({
      store,
      url,
      createSocket,
      random,
      issueTicket: api.issueTicket,
      revalidateSession: () => session.revalidate(),
      onEvent: desktop ? (event) => notifyOf(event, store, userId, desktop.notifier) : undefined,
    });
    const media = createMediaStore(api);
    const linkCards = createLinkCardStore(api);
    return {
      store,
      realtime,
      desktop,
      media,
      linkCards,
      createUploader: (roomId) => createAttachmentUploader(api, roomId, upload),
    };
  });

  useEffect(() => {
    value.realtime.start();
    value.desktop?.notifier.start();
    return () => {
      value.realtime.stop();
      value.desktop?.notifier.stop();
      value.store.dispose();
    };
  }, [value]);

  return <ChatContext value={value}>{children}</ChatContext>;
}

/**
 * ブラウザ通知の係を作る（ADR 0057）。Notification のない環境では null。
 * 音は、このタブで操作があったときに鳴らせるようにしておく（自動再生の制限。決定 6）。
 */
function createDesktop(): ChatContextValue["desktop"] {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  const chime = createChime();
  watchWindowInput(() => chime.unlock());
  let open = (url: string) => window.location.assign(url);
  const notifier = createDesktopNotifier({
    tabId: ulid(),
    permission: () => window.Notification.permission,
    show: (content, onClick) => {
      // アイコンは指定しない（ブラウザがサイトのアイコンを出す）。アプリのアイコンの画像はまだない
      const n = new window.Notification(content.title, { body: content.body, tag: content.tag });
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    },
    locks: navigator.locks,
    createChannel: typeof BroadcastChannel === "undefined" ? undefined : () => new BroadcastChannel("hibari:visibility"),
    visible: windowVisible,
    onVisibilityChange: watchWindowVisibility,
    playSound: () => chime.play(),
    soundEnabled,
    open: (url) => open(url),
  });
  return {
    notifier,
    setOpen: (next) => {
      open = next;
    },
  };
}

/** 届いたメッセージを、規則（desktop-notification.ts）に当てて通知する。値はストアに当てた後のものを読む。 */
function notifyOf(event: ServerEvent, store: ChatStore, userId: string, notifier: DesktopNotifier) {
  if (event.type !== "message.created") return;
  const state = store.getSnapshot();
  const message = event.data;
  const room = state.rooms[message.room_id];
  if (!room) return;
  const thread =
    message.thread_root_id === null
      ? undefined
      : state.threadLists[room.workspace_id]?.list.find((t) => t.root.id === message.thread_root_id);
  const input = { message, userId, room, level: state.notificationLevels[room.workspace_id], thread, now: Date.now() };
  if (shouldNotify(input)) notifier.notify(notificationContent(message, room));
}

/** ブラウザ通知を押したときの移動を、画面のルーターに任せる（ページを読み込み直さない）。 */
export function useDesktopNotificationOpen(open: (url: string) => void): void {
  const { desktop } = useChatContext();
  useEffect(() => {
    desktop?.setOpen(open);
  }, [desktop, open]);
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

/**
 * 本文に貼られたパーマリンクのカードの中身（ADR 0040）。画面に出ているリンクを頼み、取れたものを返す。
 * 取り直さないので、同じリンクは 1 回しか取りにいかない。
 */
export function useLinkCards(links: readonly LinkTarget[]): LinkCardState {
  const { linkCards } = useChatContext();
  const key = links.map(linkKey).join(" ");
  useEffect(() => {
    if (key !== "") linkCards.request(key.split(" ").map(parseLinkKey));
  }, [linkCards, key]);
  const get = () => linkCards.getSnapshot();
  return useSyncExternalStore(linkCards.subscribe, get, get);
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
