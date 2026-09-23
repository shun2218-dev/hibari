import { describe, expect, it } from "vitest";

import {
  dateChoiceOf,
  dateLabel,
  dateRangeOf,
  formatSearchQuery,
  parseSearchQuery,
  type SearchLookup,
  type SearchQuery,
  shiftDate,
} from "@/lib/chat/search/search-query";

const lookup: SearchLookup = {
  rooms: [
    { id: "r1", kind: "public", name: "デザインレビュー" },
    { id: "r2", kind: "private", name: "リリース準備" },
    { id: "r3", kind: "dm", name: "高橋 みゆき" },
  ],
  members: [
    { id: "u1", name: "佐藤 直樹" },
    { id: "u2", name: "中村涼" },
  ],
};

const parse = (input: string) => parseSearchQuery(input, lookup);

describe("parseSearchQuery（ADR 0061 決定 5）", () => {
  it("修飾子がなければ、全部が本文の条件になる", () => {
    expect(parse("面談 の資料")).toEqual({ text: "面談 の資料" });
  });

  it("in: でチャンネルを引く", () => {
    expect(parse("面談 in:#デザインレビュー")).toEqual({
      text: "面談",
      room: { id: "r1", kind: "public", name: "デザインレビュー" },
    });
  });

  it("in:@ で DM を引く（引用符は @ の内でも外でもよい）", () => {
    expect(parse(`in:"@高橋 みゆき"`).room?.id).toBe("r3");
    expect(parse(`in:@"高橋 みゆき"`).room?.id).toBe("r3");
  });

  it("from: で送信者を引く（空白を含む名前は引用符で囲む）", () => {
    expect(parse(`面談 from:"@佐藤 直樹"`)).toEqual({
      text: "面談",
      sender: { id: "u1", name: "佐藤 直樹" },
    });
  });

  it("@ を付けなくても引ける", () => {
    expect(parse("from:中村涼").sender?.id).toBe("u2");
  });

  it("日付の修飾子を範囲にする", () => {
    expect(parse("面談 after:2026-09-01")).toEqual({ text: "面談", after: "2026-09-01" });
    expect(parse("面談 before:2026-09-30")).toEqual({ text: "面談", before: "2026-09-30" });
    expect(parse("面談 on:2026-09-10")).toEqual({ text: "面談", after: "2026-09-10", before: "2026-09-10" });
  });

  it("解決できない名前は本文の条件に残す（黙って捨てない）", () => {
    expect(parse("in:#ないチャンネル 面談")).toEqual({ text: "in:#ないチャンネル 面談" });
    expect(parse("from:@いない人")).toEqual({ text: "from:@いない人" });
  });

  it("日付の形になっていなければ本文の条件に残す", () => {
    expect(parse("after:きのう")).toEqual({ text: "after:きのう" });
  });

  it("打っている途中（`in:` だけ）でも落ちない", () => {
    expect(parse("in:")).toEqual({ text: "in:" });
  });

  it("修飾子の大文字小文字は見ない", () => {
    expect(parse("In:#デザインレビュー").room?.id).toBe("r1");
  });

  it("修飾子はどこに書いてもよい", () => {
    expect(parse("in:#デザインレビュー 面談 from:中村涼")).toEqual({
      text: "面談",
      room: { id: "r1", kind: "public", name: "デザインレビュー" },
      sender: { id: "u2", name: "中村涼" },
    });
  });
});

describe("formatSearchQuery", () => {
  it("条件を入力欄の文字列にする", () => {
    const query: SearchQuery = {
      text: "面談",
      room: { id: "r1", kind: "public", name: "デザインレビュー" },
      sender: { id: "u1", name: "佐藤 直樹" },
    };
    expect(formatSearchQuery(query)).toBe(`in:#デザインレビュー from:"@佐藤 直樹" 面談`);
  });

  it("DM は @ を付ける", () => {
    expect(formatSearchQuery({ text: "", room: { id: "r3", kind: "dm", name: "高橋 みゆき" } })).toBe(`in:"@高橋 みゆき"`);
  });

  it("同じ日なら on: にまとめる", () => {
    expect(formatSearchQuery({ text: "面談", after: "2026-09-10", before: "2026-09-10" })).toBe("on:2026-09-10 面談");
  });

  it("本文の条件だけなら修飾子を付けない", () => {
    expect(formatSearchQuery({ text: "面談" })).toBe("面談");
  });
});

describe("入力欄とフィルターは同じ状態を編集する（往復しても変わらない）", () => {
  const cases: SearchQuery[] = [
    { text: "面談" },
    { text: "面談", room: { id: "r1", kind: "public", name: "デザインレビュー" } },
    { text: "面談", room: { id: "r3", kind: "dm", name: "高橋 みゆき" } },
    { text: "面談", sender: { id: "u1", name: "佐藤 直樹" } },
    { text: "面談", after: "2026-09-01" },
    { text: "面談", before: "2026-09-30" },
    { text: "面談", after: "2026-09-10", before: "2026-09-10" },
    { text: "面談 資料", after: "2026-09-01", before: "2026-09-30" },
    {
      text: "面談",
      room: { id: "r2", kind: "private", name: "リリース準備" },
      sender: { id: "u2", name: "中村涼" },
      after: "2026-09-01",
    },
  ];
  it.each(cases.map((q) => [formatSearchQuery(q), q] as const))("%s", (_text, query) => {
    expect(parse(formatSearchQuery(query))).toEqual(query);
  });
});

describe("日付の選択肢", () => {
  const today = "2026-09-23";

  it("選択肢を範囲にする", () => {
    expect(dateRangeOf("any", today)).toEqual({});
    expect(dateRangeOf("today", today)).toEqual({ after: today, before: today });
    expect(dateRangeOf("7d", today)).toEqual({ after: "2026-09-17" });
    expect(dateRangeOf("30d", today)).toEqual({ after: "2026-08-25" });
  });

  it("範囲から選択肢に戻せる", () => {
    expect(dateChoiceOf({}, today)).toBe("any");
    expect(dateChoiceOf(dateRangeOf("today", today), today)).toBe("today");
    expect(dateChoiceOf(dateRangeOf("30d", today), today)).toBe("30d");
    // 選択肢に当てはまらない範囲
    expect(dateChoiceOf({ after: "2020-01-01" }, today)).toBe("any");
  });

  it("チップの文言", () => {
    expect(dateLabel({}, today)).toBeUndefined();
    expect(dateLabel(dateRangeOf("7d", today), today)).toBe("過去 7 日間");
    expect(dateLabel({ after: "2020-01-01" }, today)).toBe("2020-01-01 以降");
    expect(dateLabel({ before: "2020-01-01" }, today)).toBe("2020-01-01 まで");
    expect(dateLabel({ after: "2020-01-01", before: "2020-01-31" }, today)).toBe("2020-01-01 〜 2020-01-31");
  });

  it("月をまたいでもずらせる", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });
});
