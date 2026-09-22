import type {
  EditMessageRequest,
  MarkRoomReadRequest,
  Message,
  MessageLinks,
  MessageList,
  ReadState,
  SendMessageRequest,
} from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session";

/** 1 ページのメッセージの数。API の既定と同じ（ADR 0012）。 */
export const MESSAGE_PAGE_SIZE = 50;

/** 差分の取得の 1 ページの数。API の上限（ADR 0012）。 */
export const CHANGE_PAGE_SIZE = 100;

/** メッセージへのリンクのカードを 1 回で取れる件数。API の上限（ADR 0040）。 */
export const LINK_BATCH_SIZE = 20;

export function messagePath(roomId: string, messageId: string): string {
  return `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`;
}

export function reactionPath(roomId: string, messageId: string, emoji: string): string {
  return `${messagePath(roomId, messageId)}/reactions/${encodeURIComponent(emoji)}`;
}

/**
 * メッセージの取得・送信・編集・削除（ADR 0012 / 0027）、既読、リアクション（ADR 0044）、パーマリンクのカード（ADR 0040）。
 */
export function createMessageApi(request: Session["request"]) {
  return {
    /**
     * カーソルを省くと最新のページ。messages は常に seq の昇順（ADR 0012）。
     *
     * カーソルは 1 つだけ指定できる（2 つ以上はサーバーが 422 にする。ADR 0042）。
     * - beforeSeq: その seq より古い方へ
     * - afterSeq: その seq より新しい方へ（最初の未読から読み直すのに使う）
     * - aroundMessageId: そのメッセージを真ん中に置いて前後。見つからなければ最新のページが around: null で返る
     */
    listMessages: (
      roomId: string,
      { beforeSeq, afterSeq, aroundMessageId }: { beforeSeq?: number; afterSeq?: number; aroundMessageId?: string } = {},
    ) => {
      const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
      if (beforeSeq !== undefined) params.set("before_seq", String(beforeSeq));
      if (afterSeq !== undefined) params.set("after_seq", String(afterSeq));
      if (aroundMessageId !== undefined) params.set("around_message_id", aroundMessageId);
      return request<MessageList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages?${params}`);
    },

    /** change_seq が afterChangeSeq より大きいメッセージを、change_seq の昇順で返す（再接続の差分。ADR 0014）。 */
    listChanges: (roomId: string, afterChangeSeq: number) => {
      const params = new URLSearchParams({ after_change_seq: String(afterChangeSeq), limit: String(CHANGE_PAGE_SIZE) });
      return request<MessageList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages?${params}`);
    },

    /** 同じ client_msg_id の再送は、既存のメッセージを 200 で返す（ADR 0004 / 0012）。 */
    sendMessage: (roomId: string, body: SendMessageRequest) =>
      request<Message>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, body),

    editMessage: (roomId: string, messageId: string, body: EditMessageRequest) =>
      request<Message>(
        "PATCH",
        `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
        body,
      ),

    /** 削除済みでも 204（冪等。ADR 0012）。 */
    deleteMessage: (roomId: string, messageId: string) =>
      request<void>("DELETE", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`),

    markRead: (roomId: string, body: MarkRoomReadRequest) =>
      request<ReadState>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/read`, body),

    /**
     * 絵文字のリアクションを付ける / 外す（ADR 0044 決定 4）。どちらも冪等で、更新後のメッセージを返す。
     * 絵文字はパスに置く（主キーとそのまま対応し、冪等性が URL の形から読める）。
     */
    addReaction: (roomId: string, messageId: string, emoji: string) =>
      request<Message>("PUT", reactionPath(roomId, messageId, emoji)),

    removeReaction: (roomId: string, messageId: string, emoji: string) =>
      request<Message>("DELETE", reactionPath(roomId, messageId, emoji)),

    /**
     * 本文に貼られたパーマリンクのカードの中身をまとめて取る（ADR 0040）。
     * 副作用はないが ID の配列を渡すので POST。結果は送った順・同じ件数で返る。
     */
    resolveMessageLinks: (links: readonly { roomId: string; messageId: string }[]) =>
      request<MessageLinks>("POST", "/api/v1/messages/links", {
        links: links.map((l) => ({ room_id: l.roomId, message_id: l.messageId })),
      }),
  };
}
