"use client";

import { type ReactNode, createContext, useEffect, useState } from "react";

import { useSession } from "@/hooks/auth/use-session";
import { getApiBaseUrl } from "@/lib/api/base-url";
import type { ServerEvent } from "@/lib/api/types.gen";
import { createChatApi } from "@/lib/chat/api/chat-api";
import { channelTable } from "@/lib/chat/format/channel-links";
import { createSearchStore, type SearchStore } from "@/lib/chat/search/search-store";
import { type LinkCardStore, createLinkCardStore } from "@/lib/chat/format/link-cards";
import { type MediaStore, createMediaStore } from "@/lib/chat/media/media-store";
import { type AttachmentUploader, type UploaderOptions, createAttachmentUploader } from "@/lib/chat/media/uploads";
import { notificationContent, shouldNotify } from "@/lib/chat/notifications/desktop-notification";
import { type DesktopNotifier, createChime, createDesktopNotifier } from "@/lib/chat/notifications/desktop-notifier";
import { soundEnabled } from "@/lib/chat/notifications/notification-prefs";
import { watchWindowInput, watchWindowVisibility, windowVisible } from "@/lib/chat/realtime/activity";
import { type SocketLike, webSocketUrl } from "@/lib/chat/realtime/connection";
import { type Realtime, createRealtime } from "@/lib/chat/realtime/subscriptions";
import { type ChatStore, createChatStore } from "@/lib/chat/store/chat-store";
import { ulid } from "@/lib/ulid";

export type ChatContextValue = {
  store: ChatStore;
  realtime: Realtime;
  /**
   * ブラウザ通知（ADR 0057）。押したときの移動は画面（ルーター）が決めるので、あとから setOpen で渡す。
   * テストや Notification のない環境では null。
   */
  desktop: { notifier: DesktopNotifier; setOpen: (open: (url: string) => void) => void } | null;
  media: MediaStore;
  linkCards: LinkCardStore;
  /**
   * 検索の結果（ADR 0061）。チャットの本体のストアとは別に持つ。
   * 結果は要求した時点のもので、WebSocket でも再接続の同期でも触らない（決定 8）。
   */
  search: SearchStore;
  createUploader: (roomId: string) => AttachmentUploader;
};

/** 値を読むフックは hooks/chat/ に置く（ADR 0060）。ここは作って配るだけ。 */
export const ChatContext = createContext<ChatContextValue | null>(null);

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
    const search = createSearchStore(api);
    return {
      store,
      realtime,
      desktop,
      media,
      linkCards,
      search,
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
  if (!shouldNotify(input)) return;
  // 本文の `<#ID>` の名前は、そのワークスペースのルーム一覧から引く（ADR 0062 決定 5）
  const rooms = (state.roomLists[room.workspace_id]?.ids ?? []).flatMap((id) => state.rooms[id] ?? []);
  notifier.notify(notificationContent(message, room, channelTable(rooms)));
}
