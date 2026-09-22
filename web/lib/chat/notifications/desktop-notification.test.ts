import { describe, expect, it } from "vitest";

import type { FollowedThread, Message, NotifyLevel, Room, RoomNotifications } from "@/lib/api/types.gen";
import { message, miyuki, naoki, room } from "@/test/chat-data";

import { notificationContent, plainText, shouldNotify } from "./desktop-notification";

const me = naoki.id;
const NOW = Date.parse("2026-09-22T09:00:00Z");

function input({
  msg = {},
  kind = "public",
  notifications = { level: null, muted: false, muted_until: null },
  level = "mentions",
  thread,
}: {
  msg?: Partial<Message>;
  kind?: Room["kind"];
  notifications?: RoomNotifications | null;
  level?: NotifyLevel;
  thread?: Partial<FollowedThread>;
}) {
  return {
    message: message(5, { room_id: "r1", sender: miyuki, ...msg }),
    userId: me,
    room: room("r1", "雑談", { kind, notifications }),
    level,
    thread: thread ? ({ notify_replies: true, ...thread } as FollowedThread) : undefined,
    now: NOW,
  };
}

const mentionMe = { mentions: [{ kind: "user" as const, user: naoki }] };
const channel = { mentions: [{ kind: "channel" as const }] };
const here = { mentions: [{ kind: "here" as const }] };
const threadOnly = { thread_root_id: "m-1", thread_seq: 2, also_in_channel: false };

describe("shouldNotify（ADR 0057 決定 1）", () => {
  it.each([
    ["全体が mentions: ただの投稿は出さない", input({}), false],
    ["全体が mentions: 自分宛てのメンションは出す", input({ msg: mentionMe }), true],
    ["@channel も自分宛て", input({ msg: channel }), true],
    ["@here は理由にしない（自分は離席で対象外）", input({ msg: here }), false],
    ["全体が all: ただの投稿も出す", input({ level: "all" }), true],
    ["全体が none: メンションでも出さない", input({ level: "none", msg: mentionMe }), false],
    ["チャンネルの上書き all が全体の none に勝つ", input({ level: "none", notifications: { level: "all", muted: false, muted_until: null } }), true],
    ["チャンネルの上書き mentions: ただの投稿は出さない", input({ level: "all", notifications: { level: "mentions", muted: false, muted_until: null } }), false],
    ["ミュートしていればメンションでも出さない", input({ msg: mentionMe, notifications: { level: null, muted: true, muted_until: null } }), false],
    ["期限の来たミュートは効かない", input({ msg: mentionMe, notifications: { level: null, muted: true, muted_until: "2026-09-22T08:00:00Z" } }), true],
    ["DM は全体が none でなければ出す", input({ kind: "dm" }), true],
    ["DM も全体が none なら出さない", input({ kind: "dm", level: "none" }), false],
    ["ミュートした DM は出さない", input({ kind: "dm", notifications: { level: null, muted: true, muted_until: null } }), false],
    ["自分の投稿は出さない", input({ level: "all", msg: { sender: naoki } }), false],
    ["ログは出さない", input({ level: "all", msg: { kind: "system" } }), false],
    ["参加していないルーム（設定を持たない）は出さない", input({ level: "all", notifications: null }), false],
    ["スレッドだけの返信: 参加していて通知がオンなら出す", input({ msg: threadOnly, thread: {} }), true],
    ["スレッドだけの返信: 全体が all でも、参加していなければ出さない", input({ level: "all", msg: threadOnly }), false],
    ["スレッドだけの返信: 通知をオフにしていれば出さない", input({ msg: threadOnly, thread: { notify_replies: false } }), false],
    ["スレッドだけの返信: オフでもメンションなら出す（ADR 0056 決定 3）", input({ msg: { ...threadOnly, ...mentionMe }, thread: { notify_replies: false } }), true],
    ["チャンネルにも出した返信は、チャンネルの投稿としても判定する", input({ level: "all", msg: { ...threadOnly, also_in_channel: true } }), true],
  ])("%s", (_name, given, want) => {
    expect(shouldNotify(given)).toBe(want);
  });
});

describe("notificationContent（ADR 0057 決定 3）", () => {
  it("タイトルは送信者と場所、本文は平文、押したらそのメッセージへ", () => {
    const got = notificationContent(
      message(5, { id: "m-5", room_id: "r1", sender: miyuki, body: `*確認* お願いします <@${naoki.id}>`, ...mentionMe }),
      room("r1", "雑談", { workspace_id: "ws-1" }),
    );
    expect(got).toEqual({ title: "高橋 みゆき（#雑談）", body: "確認 お願いします @佐藤 直樹", tag: "m-5", url: "/w/ws-1/r/r1?m=m-5" });
  });

  it("DM は送信者だけ、スレッドの返信はパネルを開く先、添付だけは決まった文言", () => {
    const dm = notificationContent(message(5, { id: "m-5", sender: miyuki, body: "" }), room("d1", "", { kind: "dm", workspace_id: "ws-1" }));
    expect(dm).toMatchObject({ title: "高橋 みゆき", body: "ファイルを送信しました" });

    const reply = notificationContent(
      message(6, { id: "m-6", sender: miyuki, body: "返信", thread_root_id: "m-1" }),
      room("r1", "雑談", { workspace_id: "ws-1" }),
    );
    expect(reply).toMatchObject({ title: "高橋 みゆき（#雑談 のスレッド）", url: "/w/ws-1/r/r1?m=m-6&t=m-1" });
  });

  it("本文は 100 文字で切る", () => {
    const got = notificationContent(message(5, { sender: miyuki, body: "あ".repeat(120) }), room("r1", "雑談"));
    expect(got.body).toBe(`${"あ".repeat(100)}…`);
  });
});

describe("plainText", () => {
  it("書式の記号・リンク・コード・リストを平文にする", () => {
    expect(plainText("_斜体_ と `code` と <https://example.com|手順書>\n- 1 つ目\n- 2 つ目", {})).toBe("斜体 と code と 手順書 1 つ目 2 つ目");
    expect(plainText("<!channel> 集合", {})).toBe("@channel 集合");
  });
});
