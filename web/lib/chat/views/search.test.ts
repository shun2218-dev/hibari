import { describe, expect, it } from "vitest";

import type { SearchResult } from "@/lib/api/types.gen";
import { toSearchResultView } from "@/lib/chat/views/search";

const now = new Date("2026-09-23T03:00:00Z");

const result = (overrides: Partial<SearchResult> = {}): SearchResult =>
  ({
    id: "m-1",
    room_id: "r-1",
    seq: 7,
    room: { id: "r-1", kind: "public", name: "デザインレビュー", dm_peer: null },
    sender: { id: "u-1", handle: "naoki", display_name: "佐藤 直樹" },
    body: "明日の面談の資料",
    thread_root_id: null,
    created_at: "2026-09-23T01:00:00Z",
    edited_at: null,
    attachment_count: 0,
    ...overrides,
  }) as SearchResult;

describe("検索結果の 1 件（ADR 0061 決定 7）", () => {
  it("押すとそのメッセージへ飛ぶ（6.11 のパーマリンク）", () => {
    const view = toSearchResultView(result(), "ws-1", { now });

    expect(view).toMatchObject({
      key: "m-1",
      href: "/w/ws-1/r/r-1?m=m-1",
      room: { kind: "public", name: "デザインレビュー" },
      sender: { id: "u-1", name: "佐藤 直樹" },
      body: "明日の面談の資料",
      inThread: false,
      attachmentCount: 0,
    });
  });

  it("スレッドの返信は `t=` を付けて、飛んだ先でスレッドが開くようにする", () => {
    const view = toSearchResultView(result({ thread_root_id: "m-root" }), "ws-1", { now });

    expect(view.href).toBe("/w/ws-1/r/r-1?m=m-1&t=m-root");
    expect(view.inThread).toBe(true);
  });

  it("左のメニューを行き先に残す（ADR 0058 決定 1）", () => {
    const view = toSearchResultView(result(), "ws-1", { now, side: "activity" });

    expect(view.href).toBe("/w/ws-1/r/r-1?m=m-1&side=activity");
  });

  it("DM はルーム名がないので、相手の表示名を出す", () => {
    const view = toSearchResultView(
      result({
        room: {
          id: "r-dm",
          kind: "dm",
          name: "",
          dm_peer: { id: "u-2", handle: "miyuki", display_name: "高橋 みゆき" },
        } as SearchResult["room"],
      }),
      "ws-1",
      { now },
    );

    expect(view.room).toEqual({ kind: "dm", name: "高橋 みゆき" });
  });

  it("送信者のアバターとメンションの名前を引き継ぐ", () => {
    const view = toSearchResultView(result(), "ws-1", {
      now,
      avatarUrls: { "u-1": "https://example.com/a.png" },
      memberNames: { "u-2": "高橋 みゆき" },
    });

    expect(view.sender.avatarUrl).toBe("https://example.com/a.png");
    expect(view.mentionNames).toEqual({ "u-2": "高橋 みゆき" });
  });

  it("添付の件数をそのまま渡す", () => {
    expect(toSearchResultView(result({ attachment_count: 2 }), "ws-1", { now }).attachmentCount).toBe(2);
  });
});
