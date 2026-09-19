import { describe, expect, it } from "vitest";

import { kei, message, miyuki, naoki, room, systemMessage } from "@/test/chat-data";

import {
  advanceCursor,
  applyMessageToRoom,
  applyReadToRoom,
  inChannel,
  insertByActivity,
  mergeIntoWindow,
  mergeMessages,
  newestChannelSeq,
} from "./messages";

describe("mergeMessages", () => {
  it("orders by seq regardless of created_at or arrival order", () => {
    const merged = mergeMessages(
      [message(3, { created_at: "2026-09-13T00:00:00Z" })],
      [message(5), message(1, { created_at: "2026-09-13T09:00:00Z" })],
    );

    expect(merged.map((m) => m.seq)).toEqual([1, 3, 5]);
  });

  it("keeps the copy with the larger change_seq when the same message arrives twice", () => {
    const edited = message(2, { body: "編集後", change_seq: 10 });
    const stale = message(2, { body: "編集前", change_seq: 2 });

    expect(mergeMessages([edited], [stale])[0].body).toBe("編集後");
    expect(mergeMessages([stale], [edited])[0].body).toBe("編集後");
  });

  it("does not mutate its inputs", () => {
    const current = [message(2)];
    const incoming = [message(1)];

    mergeMessages(current, incoming);

    expect(current.map((m) => m.seq)).toEqual([2]);
    expect(incoming.map((m) => m.seq)).toEqual([1]);
  });
});

describe("mergeIntoWindow", () => {
  it("drops changes to messages older than the loaded range while older pages remain", () => {
    const current = [message(50), message(51)];

    const merged = mergeIntoWindow(current, true, [message(10, { change_seq: 60 }), message(52, { change_seq: 61 })]);

    expect(merged.map((m) => m.seq)).toEqual([50, 51, 52]);
  });

  it("takes everything when the whole history is loaded", () => {
    const merged = mergeIntoWindow([message(2)], false, [message(1, { change_seq: 5 })]);

    expect(merged.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("returns the same array when nothing applies", () => {
    const current = [message(50)];

    expect(mergeIntoWindow(current, true, [message(3)])).toBe(current);
  });
});

describe("advanceCursor", () => {
  it("moves over consecutive change_seq only", () => {
    const messages = [message(1, { change_seq: 4 }), message(2, { change_seq: 5 }), message(3, { change_seq: 7 })];

    expect(advanceCursor(3, messages)).toBe(5);
    expect(advanceCursor(6, messages)).toBe(7);
    expect(advanceCursor(10, messages)).toBe(10);
  });
});

describe("applyMessageToRoom", () => {
  const me = naoki.id;
  const base = room("r1", "雑談", {
    last_message_seq: 5, last_read_seq: 3, last_user_seq: 5, last_read_user_seq: 3, unread_count: 2,
  });

  it("ignores thread replies: no unread, last message or order change (ADR 0036)", () => {
    const threadReply = message(6, { user_seq: 5, body: "返信", thread_root_id: "m-5", thread_seq: 1 });

    expect(applyMessageToRoom(base, threadReply, me, true)).toBe(base);
    expect(applyMessageToRoom(base, { ...threadReply, sender: naoki }, me, true)).toBe(base);
  });

  it("counts a reply sent to the channel as a channel message (ADR 0039)", () => {
    const broadcast = message(6, {
      sender: miyuki, body: "流した返信", thread_root_id: "m-5", thread_seq: 1, also_in_channel: true,
    });

    // 未読もサイドバーの最後の 1 行も、チャンネルの投稿と同じように進む
    expect(applyMessageToRoom(base, broadcast, me, true)).toMatchObject({
      last_message_seq: 6,
      last_user_seq: 6,
      unread_count: 3,
      last_message: { id: "m-6", body: "流した返信" },
    });
  });

  it("メンションの数は足す。同じイベントが 2 回来ても二重に足さない（ADR 0043）", () => {
    const toMe = message(6, { sender: miyuki, body: "確認おねがいします", mentions: [{ kind: "user", user: naoki }] });

    const once = applyMessageToRoom(base, toMe, me, true);
    expect(once.mention_count).toBe(base.mention_count + 1);
    expect(applyMessageToRoom(once, toMe, me, true)).toBe(once);
  });

  it("@channel と @here も自分宛てに数える", () => {
    const toAll = message(6, { sender: miyuki, body: "<!here> いますか", mentions: [{ kind: "here", user: naoki }] });

    expect(applyMessageToRoom(base, toAll, me, true).mention_count).toBe(base.mention_count + 1);
  });

  it("他の人へのメンションと自分の発言では増えない", () => {
    const toOther = message(6, { sender: miyuki, mentions: [{ kind: "user", user: kei }] });
    const mine = message(6, { sender: naoki, mentions: [{ kind: "user", user: naoki }, { kind: "channel" }] });

    expect(applyMessageToRoom(base, toOther, me, true).mention_count).toBe(base.mention_count);
    expect(applyMessageToRoom(base, mine, me, true).mention_count).toBe(base.mention_count);
  });

  it("updates the last message and recomputes unread from seq, so a duplicate does not count twice", () => {
    const created = message(6, { sender: miyuki, body: "新着" });

    const once = applyMessageToRoom(base, created, me, true);
    const twice = applyMessageToRoom(once, created, me, true);

    expect(once).toMatchObject({ last_message_seq: 6, unread_count: 3, last_message: { id: "m-6", body: "新着" } });
    expect(twice).toBe(once);
  });

  it("does not count a system message as unread (ADR 0033)", () => {
    const joined = systemMessage(6, { type: "member_joined" });

    // user_seq が進まないので未読数は変わらず、サイドバーの 1 行だけが入れ替わる
    expect(applyMessageToRoom(base, joined, me, true)).toMatchObject({
      last_message_seq: 6,
      unread_count: 2,
      last_message: { kind: "system" },
    });
  });

  it("moves my read position with my own message", () => {
    expect(applyMessageToRoom(base, message(6, { sender: naoki }), me, true)).toMatchObject({
      last_read_seq: 6,
      unread_count: 0,
    });
  });

  it("keeps unread at zero in a public room I have not joined", () => {
    const guest = room("r1", "雑談", {
      is_member: false, last_read_seq: null, last_read_user_seq: null, last_message_seq: 5, last_user_seq: 5,
    });

    expect(applyMessageToRoom(guest, message(6), me, true)).toMatchObject({ last_read_seq: null, unread_count: 0 });
  });

  it("reflects an edit or deletion only when it is the last message", () => {
    const withLast = applyMessageToRoom(base, message(6), me, true);

    // 最後のメッセージの削除では、ひとつ前を取り直すまで空にする（ADR 0038）
    expect(applyMessageToRoom(withLast, message(6, { deleted_at: "2026-09-13T02:00:00Z", body: "" }), me, false))
      .toMatchObject({ last_message: null });
    expect(applyMessageToRoom(withLast, message(6, { body: "編集" }), me, false)).toMatchObject({ last_message: { body: "編集" } });
    expect(applyMessageToRoom(withLast, message(4, { body: "古い編集" }), me, false)).toBe(withLast);
  });
});

describe("applyReadToRoom", () => {
  it("never moves the read position back", () => {
    const r = room("r1", "雑談", {
      last_message_seq: 9, last_read_seq: 7, last_user_seq: 9, last_read_user_seq: 7, unread_count: 2,
    });

    expect(applyReadToRoom(r, { lastReadSeq: 5, lastReadUserSeq: 5, mentionCount: 0 })).toBe(r);
    expect(applyReadToRoom(r, { lastReadSeq: 9, lastReadUserSeq: 9, mentionCount: 0 })).toMatchObject({
      last_read_seq: 9,
      unread_count: 0,
    });
  });

  it("メンションの数はサーバーの値をそのまま使う（ADR 0043）", () => {
    const r = room("r1", "雑談", {
      last_message_seq: 9, last_read_seq: 7, last_user_seq: 9, last_read_user_seq: 7, unread_count: 2, mention_count: 2,
    });

    // 既読が進めば、サーバーの数で上書きする
    expect(applyReadToRoom(r, { lastReadSeq: 9, lastReadUserSeq: 9, mentionCount: 0 })).toMatchObject({
      unread_count: 0,
      mention_count: 0,
    });
    // 既読が進まない応答では触らない（古い値で上書きしない）
    expect(applyReadToRoom(r, { lastReadSeq: 5, lastReadUserSeq: 5, mentionCount: 0 })).toBe(r);
  });
});

describe("insertByActivity", () => {
  it("places a room by its last message time, rooms without messages last", () => {
    const rooms = {
      a: room("a", "a", { last_message_at: "2026-09-13T03:00:00Z" }),
      b: room("b", "b", { last_message_at: "2026-09-13T01:00:00Z" }),
      c: room("c", "c"),
    };
    const middle = room("n", "n", { last_message_at: "2026-09-13T02:00:00Z" });

    expect(insertByActivity(["a", "b", "c"], middle, rooms)).toEqual(["a", "n", "b", "c"]);
    expect(insertByActivity(["a", "b", "c"], room("n", "n"), rooms)).toEqual(["a", "b", "c", "n"]);
  });
});

describe("inChannel", () => {
  it("covers channel messages and replies sent to the channel (ADR 0039)", () => {
    expect(inChannel(message(1))).toBe(true);
    expect(inChannel(message(2, { thread_root_id: "m-1", thread_seq: 1 }))).toBe(false);
    expect(inChannel(message(3, { thread_root_id: "m-1", thread_seq: 2, also_in_channel: true }))).toBe(true);
  });
});

describe("newestChannelSeq", () => {
  it("takes the newest row shown in the channel, skipping replies kept only for the sync cursor", () => {
    const messages = [
      message(1),
      message(2, { thread_root_id: "m-1", thread_seq: 1, also_in_channel: true }),
      message(3, { thread_root_id: "m-1", thread_seq: 2 }),
    ];

    expect(newestChannelSeq(messages)).toBe(2);
    expect(newestChannelSeq([message(4, { thread_root_id: "m-1", thread_seq: 1 })])).toBeUndefined();
    expect(newestChannelSeq([])).toBeUndefined();
  });
});
