import type { TimelineItem } from "@/components/chat/types";
import type { MessageAttachment, MessageLink } from "@/lib/api/types.gen";
import { toTimelineItems } from "@/lib/chat/views/timeline";
import { naoki } from "@/test/chat-data";

/**
 * 表示用の変換（lib/chat/views/）のテストで共有する値と道具。
 */
export const tz = "Asia/Tokyo";

/** 区切りは種類、メッセージは「本文（grouped なら +）」にして並びを比べる。 */
export function outline(items: TimelineItem[]): string[] {
  return items.map((item) => {
    switch (item.type) {
      case "date":
        return `[${item.label}]`;
      case "unread":
        return "[unread]";
      case "system":
        return `[system: ${item.text}]`;
      case "thread-divider":
        return `[${item.replyCount} replies]`;
      case "message":
        return item.message.grouped ? `+${item.message.body}` : item.message.body;
    }
  });
}

export const png: MessageAttachment = {
  id: "a1",
  file_name: "mock.png",
  content_type: "image/png",
  size_bytes: 10,
  width: 260,
  height: 160,
};
export const pdf: MessageAttachment = {
  id: "a2",
  file_name: "scale.pdf",
  content_type: "application/pdf",
  size_bytes: 253_952,
  width: null,
  height: null,
};

// 本文に貼られたパーマリンクのカード（ADR 0040）

export const ORIGIN = "https://hibari.example";
export const WS = "01J9ZQZQZQZQZQZQZQZQZQZQZA";
export const OTHER_WS = "01J9ZQZQZQZQZQZQZQZQZQZQZF";
export const LINK_ROOM = "01J9ZQZQZQZQZQZQZQZQZQZQZB";
export const LINK_MSG = "01J9ZQZQZQZQZQZQZQZQZQZQZC";
export const PERMALINK = `${ORIGIN}/w/${WS}/r/${LINK_ROOM}?m=${LINK_MSG}`;
export const LINK_KEY = `${LINK_ROOM}/${LINK_MSG}`;

export function linkResult(overrides: Partial<MessageLink> = {}): MessageLink {
  return {
    room_id: LINK_ROOM,
    message_id: LINK_MSG,
    status: "ok",
    workspace: { id: WS, name: "山と印刷" },
    room: { id: LINK_ROOM, kind: "public", name: "雑談", dm_peer: null },
    message: {
      id: LINK_MSG,
      seq: 7,
      sender: naoki,
      body: "元の発言",
      thread_root_id: null,
      attachment_count: 0,
      created_at: "2026-09-13T01:30:00Z",
      edited_at: null,
      deleted_at: null,
    },
    ...overrides,
  };
}

/** linkResult().message は必ず入る（ok の結果を作るヘルパー）ので、絞り込みを 1 箇所にまとめる。 */
export function linkMessage(): NonNullable<MessageLink["message"]> {
  return linkResult().message!;
}

export function cardsOf(
  messages: Parameters<typeof toTimelineItems>[0],
  linkCards: Record<string, MessageLink>,
  extra: Partial<Parameters<typeof toTimelineItems>[1]> = {},
) {
  const items = toTimelineItems(messages, {
    unreadAfterSeq: null,
    origin: ORIGIN,
    linkCards,
    timeZone: tz,
    ...extra,
  });
  const first = items.find((i): i is Extract<TimelineItem, { type: "message" }> => i.type === "message");
  return first?.message.linkCards;
}
