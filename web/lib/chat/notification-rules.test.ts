import { describe, expect, it } from "vitest";

import type { NotifyLevel, RoomNotifications } from "@/lib/api/types.gen";
import { message, miyuki, naoki, room } from "@/test/chat-data";

import rules from "../../../testdata/notification-rules.json";
import { notifyReasons, shouldNotify } from "./desktop-notification";

/**
 * 通知とアクティビティの規則の表（testdata/notification-rules.json。ADR 0058 決定 6）。
 * サーバー（internal/chat/activity_rules_test.go）も同じ表を読む。規則がクライアントとサーバーの 2 か所にあるので、
 * 片方だけが変わったらどちらかのテストが落ちるようにしてある。
 */
type RuleCase = {
  name: string;
  room: "public" | "dm";
  global: NotifyLevel | null;
  room_level: "all" | "mentions" | null;
  muted: "none" | "forever" | "expired";
  from_self: boolean;
  mention: "user" | "channel" | "here" | null;
  message: "channel" | "thread" | "broadcast";
  thread_member: boolean | null;
  notify: boolean;
  activity: string[];
};

const table = rules as { cases: RuleCase[] };

const NOW = Date.parse("2026-09-22T09:00:00Z");

function mentions(kind: RuleCase["mention"]) {
  if (kind === null) return [];
  return kind === "user" ? [{ kind: "user" as const, user: naoki }] : [{ kind }];
}

describe("通知の規則の表（testdata/notification-rules.json）", () => {
  it("表が空でない", () => {
    expect(table.cases.length).toBeGreaterThan(0);
  });

  it.each(table.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const notifications: RoomNotifications = {
      level: c.room_level,
      muted: c.muted !== "none",
      muted_until: c.muted === "expired" ? "2026-09-22T08:00:00Z" : null,
    };
    const reply = c.message !== "channel";
    const input = {
      message: message(5, {
        room_id: "r1",
        sender: c.from_self ? naoki : miyuki,
        mentions: mentions(c.mention),
        thread_root_id: reply ? "m-1" : null,
        thread_seq: reply ? 2 : null,
        also_in_channel: c.message === "broadcast",
      }),
      userId: naoki.id,
      room: room("r1", "雑談", { kind: c.room, notifications }),
      level: c.global ?? undefined,
      thread: c.thread_member === null ? undefined : { notify_replies: c.thread_member } as never,
      now: NOW,
    };
    expect(shouldNotify(input)).toBe(c.notify);
    // アクティビティの理由（サーバーの activity_rules_test.go と同じ期待値）
    expect(notifyReasons(input, { countHere: true })).toEqual(c.activity);
  });
});
