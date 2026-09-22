import { describe, expect, it, vi } from "vitest";

import { message, room } from "@/test/chat-data";
import { setup, opened, msg, page, created, seqs } from "@/test/chat-store";
import { json, problem } from "@/test/fake-api";

describe("履歴の読み込み", () => {
  it("prepends older pages by seq and stops when there are no more", async () => {
    const { requests, store } = setup({
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_read_seq: 60, last_message_seq: 60 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () =>
        json(200, { messages: [message(59), message(60)], has_more: true, last_change_seq: 60 }),
      "GET /api/v1/rooms/r1/messages?limit=50&before_seq=59": () =>
        json(200, { messages: [message(57), message(58)], has_more: false, last_change_seq: 60 }),
    });
    await store.openRoom("r1");

    await Promise.all([store.loadOlder("r1"), store.loadOlder("r1")]);
    await store.loadOlder("r1");

    expect(store.getSnapshot().timelines.r1).toMatchObject({ hasOlder: false, loadingOlder: false });
    expect(store.getSnapshot().timelines.r1?.messages.map((m) => m.seq)).toEqual([57, 58, 59, 60]);
    expect(requests().filter((p) => p.includes("before_seq"))).toHaveLength(1);
  });

  it("keeps hasOlder after a failed older page so it can be retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = setup({
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_read_seq: 2, last_message_seq: 2 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () =>
        json(200, { messages: [message(2)], has_more: true, last_change_seq: 2 }),
      "GET /api/v1/rooms/r1/messages?limit=50&before_seq=2": () => problem(500, "internal"),
    });
    await store.openRoom("r1");

    await store.loadOlder("r1");

    expect(store.getSnapshot().timelines.r1).toMatchObject({ hasOlder: true, loadingOlder: false });
  });

  it("dismisses the unread divider without another request", async () => {
    const { requests, store } = setup({
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_read_seq: 1, last_message_seq: 1 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () =>
        json(200, { messages: [message(1)], has_more: false, last_change_seq: 1 }),
    });
    await store.openRoom("r1");
    const before = requests().length;

    store.dismissUnread("r1");

    expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBeNull();
    expect(requests()).toHaveLength(before);
  });

  describe("指定したメッセージへ飛ぶ（ADR 0042）", () => {
    /** around のページ。前後を返し、両側にまだあるかを伝える。 */
    function around(messages: ReturnType<typeof message>[], lastChangeSeq: number, seq: number) {
      return json(200, {
        messages,
        has_more: true,
        has_more_after: true,
        around: { seq, thread_root_id: null },
        last_change_seq: lastChangeSeq,
      });
    }

    it("前後のページで窓を置き換え、どちら側にまだあるかを覚える", async () => {
      const { store, requests } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-7": () => around([msg(6), msg(7), msg(8)], 20, 7),
      });

      const result = await store.jumpToMessage("r1", "m-7");

      expect(result).toEqual({ found: true, threadRootId: null });
      expect(seqs(store)).toEqual([6, 7, 8]);
      const timeline = store.getSnapshot().timelines.r1!;
      expect(timeline).toMatchObject({ hasOlder: true, hasNewer: true, changeSeq: 20 });
      // 開く処理より後に飛ぶ（どちらも同じ窓を置き換えるので、競争させない）
      expect(requests().at(-1)).toBe("GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-7");
    });

    it("見つからなければ最新のページのままで、見つからなかったことだけを返す", async () => {
      // ない・読めない・削除済みを区別しない（ADR 0040 と同じ方針）ので、サーバーは最新のページを around: null で返す
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-99": () =>
          json(200, { messages: [msg(1), msg(2), msg(3)], has_more: false, has_more_after: false, around: null, last_change_seq: 3 }),
      });

      expect(await store.jumpToMessage("r1", "m-99")).toEqual({ found: false, threadRootId: null });
      expect(store.getSnapshot().timelines.r1).toMatchObject({ hasNewer: false });
    });

    it("スレッドの返信を指していれば、その親を返す（呼ぶ側がパネルを開く）", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-7": () =>
          json(200, {
            messages: [msg(7, { thread_root_id: "m-2", thread_seq: 1 })],
            has_more: true,
            has_more_after: false,
            around: { seq: 7, thread_root_id: "m-2" },
            last_change_seq: 20,
          }),
        "GET /api/v1/rooms/r1/threads/m-2/messages?limit=50": () =>
          json(200, { root: msg(2), messages: [], has_more: false, has_more_after: false, around: null, last_change_seq: 20, last_read_thread_seq: 0 }),
      });

      expect(await store.jumpToMessage("r1", "m-7")).toEqual({ found: true, threadRootId: "m-2" });
    });

    it("飛んだ先にいる間は、届いたメッセージを末尾に足さない（つながらないため）", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-7": () => around([msg(6), msg(7), msg(8)], 20, 7),
      });
      await store.jumpToMessage("r1", "m-7");

      store.applyEvent(created(msg(30, { change_seq: 21 })));

      expect(seqs(store)).toEqual([6, 7, 8]);
      // 番号が続いているので、反映したことにしてカーソルだけ進める（差分を取り直さない）
      expect(store.getSnapshot().timelines.r1).toMatchObject({ changeSeq: 21 });
      // ルームの一覧（サイドバー）は、窓の外の発言でも動く
      expect(store.getSnapshot().rooms.r1?.last_message_seq).toBe(30);
    });

    it("新しい方へ読み足して最新につながると、また末尾に並ぶ", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-7": () => around([msg(6), msg(7), msg(8)], 20, 7),
        "GET /api/v1/rooms/r1/messages?limit=50&after_seq=8": () =>
          json(200, { messages: [msg(9), msg(10)], has_more: false, has_more_after: false, around: null, last_change_seq: 20 }),
        "GET /api/v1/rooms/r1/messages?after_change_seq=20&limit=100": () =>
          json(200, { messages: [], has_more: false, last_change_seq: 20 }),
      });
      await store.jumpToMessage("r1", "m-7");

      await store.loadNewer("r1");

      expect(seqs(store)).toEqual([6, 7, 8, 9, 10]);
      expect(store.getSnapshot().timelines.r1).toMatchObject({ hasNewer: false, loadingNewer: false });

      store.applyEvent(created(msg(11, { change_seq: 21 })));
      expect(seqs(store)).toEqual([6, 7, 8, 9, 10, 11]);
    });

    it("スレッドのパネルでも、指定した返信の前後で置き換える", async () => {
      const reply = (seq: number) => msg(seq, { thread_root_id: "m-2", thread_seq: seq, change_seq: seq });
      const { store } = await opened({
        "GET /api/v1/rooms/r1/threads/m-2/messages?limit=50": () =>
          json(200, { root: msg(2), messages: [reply(20)], has_more: true, has_more_after: false, around: null, last_change_seq: 20, last_read_thread_seq: 0 }),
        "GET /api/v1/rooms/r1/threads/m-2/messages?limit=50&around_message_id=m-11": () =>
          json(200, {
            root: msg(2),
            messages: [reply(10), reply(11), reply(12)],
            has_more: true,
            has_more_after: true,
            around: { seq: 11, thread_root_id: "m-2" },
            last_change_seq: 20,
            last_read_thread_seq: 0,
          }),
      });

      expect(await store.jumpToThreadMessage("r1", "m-2", "m-11")).toEqual({ found: true });

      const thread = store.getSnapshot().threads["m-2"]!;
      expect(thread.replies.map((m) => m.seq)).toEqual([10, 11, 12]);
      expect(thread).toMatchObject({ hasOlder: true, hasNewer: true });
    });

    it("最初の未読から読み直す（after_seq = 開いた時点の既読位置）", async () => {
      const { store } = setup({
        "GET /api/v1/rooms/r1": () =>
          json(200, room("r1", "雑談", { last_message_seq: 40, last_read_seq: 4, last_user_seq: 40, last_read_user_seq: 4, unread_count: 36 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () => page([msg(38), msg(39), msg(40)], 40, true),
        "GET /api/v1/rooms/r1/messages?limit=50&after_seq=4": () =>
          json(200, { messages: [msg(5), msg(6)], has_more: true, has_more_after: false, around: null, last_change_seq: 40 }),
        "POST /api/v1/rooms/r1/read": () => json(200, { last_read_seq: 40, last_read_user_seq: 40, unread_count: 0 }),
      });
      await store.openRoom("r1");
      // 未読の数は開いた時点で覚える（開くとすぐ既読にするので、ルームの unread_count は 0 になる）
      expect(store.getSnapshot().timelines.r1).toMatchObject({ unreadAtOpen: 36, unreadAfterSeq: 4 });

      await store.jumpToUnread("r1");

      expect(seqs(store)).toEqual([5, 6]);
      // 古い方は飛ばしてきたので開いたまま、新しい方も読み切っていない
      expect(store.getSnapshot().timelines.r1).toMatchObject({ hasOlder: true, hasNewer: true });
    });
  });
});
