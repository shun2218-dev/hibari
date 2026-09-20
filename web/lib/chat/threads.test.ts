import { describe, expect, it } from "vitest";

import type { FollowedThread } from "@/lib/api/types.gen";
import { message, miyuki } from "@/test/chat-data";

import { applyRootToThreads, applyThreadRead, countUnreadThreads, mergeRepliesIntoWindow } from "./threads";

function followed(id: string, overrides: Partial<FollowedThread> = {}): FollowedThread {
  return {
    room: { id: "r1", kind: "public", name: "雑談" },
    root: { id, sender: miyuki, kind: "user", body: "親", created_at: "2026-09-13T01:00:00Z", deleted: false },
    root_seq: 1,
    reply_count: 1,
    last_reply_at: "2026-09-13T01:00:00Z",
    last_thread_seq: 1,
    last_read_thread_seq: 1,
    unread_count: 0,
    ...overrides,
  };
}

describe("mergeRepliesIntoWindow", () => {
  it("keeps seq order and ignores changes to replies older than the loaded window", () => {
    const current = [message(5, { thread_root_id: "m-1" }), message(7, { thread_root_id: "m-1" })];

    const older = { hasOlder: true, hasNewer: false };
    const whole = { hasOlder: false, hasNewer: false };
    expect(mergeRepliesIntoWindow(current, older, [message(3, { thread_root_id: "m-1" })])).toBe(current);
    expect(mergeRepliesIntoWindow(current, older, [message(6, { thread_root_id: "m-1" })]).map((m) => m.seq)).toEqual([5, 6, 7]);
    expect(mergeRepliesIntoWindow(current, whole, [message(3, { thread_root_id: "m-1" })]).map((m) => m.seq)).toEqual([3, 5, 7]);
  });

  it("返信へ飛んだ後は、その先の返信を足さない（ADR 0042）", () => {
    const current = [message(5, { thread_root_id: "m-1" }), message(7, { thread_root_id: "m-1" })];

    expect(mergeRepliesIntoWindow(current, { hasOlder: true, hasNewer: true }, [message(9, { thread_root_id: "m-1" })])).toBe(current);
  });
});

describe("applyRootToThreads", () => {
  const root = (lastThreadSeq: number, replyCount: number, at: string) =>
    message(1, { id: "a", thread: { reply_count: replyCount, last_thread_seq: lastThreadSeq, last_reply_at: at } });

  it("recomputes the unread count from the counter and the read position, and moves the thread to the top", () => {
    const list = [followed("b", { last_reply_at: "2026-09-13T02:00:00Z" }), followed("a")];

    const next = applyRootToThreads(list, root(3, 2, "2026-09-13T03:00:00Z"));

    expect(next.map((t) => t.root.id)).toEqual(["a", "b"]);
    expect(next[0]).toMatchObject({ reply_count: 2, last_thread_seq: 3, unread_count: 2 });
    // 同じイベントが 2 回届いても数はずれない
    expect(applyRootToThreads(next, root(3, 2, "2026-09-13T03:00:00Z"))[0]!.unread_count).toBe(2);
  });

  it("ignores an older root and threads the user does not follow", () => {
    const list = [followed("a", { last_thread_seq: 5, last_read_thread_seq: 5 })];

    expect(applyRootToThreads(list, root(4, 1, "2026-09-13T00:00:00Z"))).toBe(list);
    expect(applyRootToThreads(list, message(9, { id: "z", thread: { reply_count: 1, last_thread_seq: 1, last_reply_at: "x" } }))).toBe(list);
  });
});

describe("applyThreadRead / countUnreadThreads", () => {
  it("advances the read position without going back, and counts threads with unread replies", () => {
    const list = [followed("a", { last_thread_seq: 3, last_read_thread_seq: 1, unread_count: 2 }), followed("b")];
    expect(countUnreadThreads(list)).toBe(1);

    const read = applyThreadRead(list, "a", 3);
    expect(read[0]).toMatchObject({ last_read_thread_seq: 3, unread_count: 0 });
    expect(countUnreadThreads(read)).toBe(0);
    expect(applyThreadRead(read, "a", 2)).toBe(read);
  });
});
