import { describe, expect, it } from "vitest";

import {
  applyCompletion,
  filterCandidates,
  findMentionQuery,
  splitBody,
  toInputBody,
  toWireBody,
  type MentionCandidate,
} from "./mentions";

const ALICE = "01J8ZZZZZZZZZZZZZZZZZZZZZA";
const BOB = "01J8ZZZZZZZZZZZZZZZZZZZZZB";

const candidates: MentionCandidate[] = [
  { kind: "user", id: ALICE, handle: "alice", name: "田中 あおい" },
  { kind: "user", id: BOB, handle: "bob_2", name: "alice_lookalike" },
  { kind: "channel", description: "このチャンネルの全員" },
  { kind: "here", description: "いまオンラインの人" },
];

const names = new Map([
  [ALICE, "田中 あおい"],
  [BOB, "佐藤 けん"],
]);
const handles = new Map([
  [ALICE, "alice"],
  [BOB, "bob_2"],
]);

describe("splitBody", () => {
  it("メンションがなければ 1 つの文字列", () => {
    expect(splitBody("こんにちは", names)).toEqual([{ type: "text", text: "こんにちは" }]);
  });

  it("空の本文は断片なし", () => {
    expect(splitBody("", names)).toEqual([]);
  });

  it("個人のトークンを名前のチップにする", () => {
    expect(splitBody(`<@${ALICE}> おはよう`, names)).toEqual([
      { type: "mention", kind: "user", id: ALICE, name: "田中 あおい" },
      { type: "text", text: " おはよう" },
    ]);
  });

  it("channel と here をチップにする", () => {
    expect(splitBody("<!channel> と <!here>", names)).toEqual([
      { type: "mention", kind: "channel" },
      { type: "text", text: " と " },
      { type: "mention", kind: "here" },
    ]);
  });

  it("前後に文字があっても切り出す", () => {
    expect(splitBody(`（<@${BOB}>）`, names)).toEqual([
      { type: "text", text: "（" },
      { type: "mention", kind: "user", id: BOB, name: "佐藤 けん" },
      { type: "text", text: "）" },
    ]);
  });

  it("名前を引けない ID は文字列のまま出す", () => {
    const body = "<@01J8YYYYYYYYYYYYYYYYYYYYYY> だれ";
    expect(splitBody(body, names)).toEqual([{ type: "text", text: body }]);
  });

  it("トークンに見えない文字列はそのまま", () => {
    expect(splitBody("@alice <@01J8> <!everyone>", names)).toEqual([
      { type: "text", text: "@alice <@01J8> <!everyone>" },
    ]);
  });
});

describe("toWireBody", () => {
  it("解決できるハンドルを ID にする", () => {
    expect(toWireBody("@alice おはよう", candidates)).toBe(`<@${ALICE}> おはよう`);
  });

  it("大文字小文字は区別しない", () => {
    expect(toWireBody("@ALICE", candidates)).toBe(`<@${ALICE}>`);
  });

  it("channel と here は全員宛てにする", () => {
    expect(toWireBody("@channel @here", candidates)).toBe("<!channel> <!here>");
  });

  it("解決できないハンドルはそのまま送る", () => {
    expect(toWireBody("@nobody @alice", candidates)).toBe(`@nobody <@${ALICE}>`);
  });

  it("空白の直後でない @ は変換しない（メールアドレスを壊さない）", () => {
    expect(toWireBody("mail@alice.example", candidates)).toBe("mail@alice.example");
  });

  it("行頭と改行の直後は変換する", () => {
    expect(toWireBody("@alice\n@bob_2", candidates)).toBe(`<@${ALICE}>\n<@${BOB}>`);
  });

  it("同じ人を 2 回書いても両方変換する（重複はサーバーがまとめる）", () => {
    expect(toWireBody("@alice @alice", candidates)).toBe(`<@${ALICE}> <@${ALICE}>`);
  });
});

describe("toInputBody", () => {
  it("ID をハンドルに戻す", () => {
    expect(toInputBody(`<@${ALICE}> と <!here>`, handles)).toBe("@alice と @here");
  });

  it("引けない ID はトークンのまま残す（保存し直してもメンションが外れない）", () => {
    const body = "<@01J8YYYYYYYYYYYYYYYYYYYYYY>";
    expect(toInputBody(body, handles)).toBe(body);
  });

  it("送る形に戻すと元の本文になる", () => {
    const body = `<@${ALICE}> <!channel> ありがとう`;
    expect(toWireBody(toInputBody(body, handles), candidates)).toBe(body);
  });
});

describe("findMentionQuery", () => {
  const cases: { name: string; value: string; caret: number; want: { start: number; query: string } | null }[] = [
    { name: "@ だけ", value: "@", caret: 1, want: { start: 0, query: "" } },
    { name: "途中まで打った", value: "@ali", caret: 4, want: { start: 0, query: "ali" } },
    { name: "空白の直後", value: "やあ @ali", caret: 7, want: { start: 3, query: "ali" } },
    { name: "改行の直後", value: "1 行目\n@ali", caret: 9, want: { start: 5, query: "ali" } },
    { name: "キャレットが語の途中", value: "@alice", caret: 3, want: { start: 0, query: "al" } },
    { name: "メールアドレスの @", value: "mail@ali", caret: 8, want: null },
    { name: "@ がない", value: "こんにちは", caret: 5, want: null },
    { name: "@ の後ろに空白が入ったら閉じる", value: "@ali ", caret: 5, want: null },
    { name: "ハンドルに使えない文字で閉じる", value: "@ali-", caret: 5, want: null },
    { name: "長すぎる", value: `@${"a".repeat(33)}`, caret: 34, want: null },
  ];
  for (const { name, value, caret, want } of cases) {
    it(name, () => {
      expect(findMentionQuery(value, caret)).toEqual(want);
    });
  }
});

describe("filterCandidates", () => {
  it("空の入力では全員とチャンネル宛てを出す", () => {
    expect(filterCandidates(candidates, "").map((c) => (c.kind === "user" ? c.handle : c.kind))).toEqual([
      "alice",
      "bob_2",
      "channel",
      "here",
    ]);
  });

  it("ハンドルの前方一致を表示名の前方一致より先に出す", () => {
    // bob_2 の表示名が alice_lookalike なので、ハンドルで当たった alice が先
    expect(filterCandidates(candidates, "ali").map((c) => (c.kind === "user" ? c.handle : c.kind))).toEqual([
      "alice",
      "bob_2",
    ]);
  });

  it("表示名でも引ける", () => {
    expect(filterCandidates(candidates, "田中").map((c) => (c.kind === "user" ? c.handle : c.kind))).toEqual(["alice"]);
  });

  it("channel と here は前方一致したときだけ", () => {
    expect(filterCandidates(candidates, "ch").map((c) => c.kind)).toEqual(["channel"]);
    expect(filterCandidates(candidates, "z")).toEqual([]);
  });

  it("上限で切る", () => {
    const many: MentionCandidate[] = Array.from({ length: 20 }, (_, i) => ({
      kind: "user",
      id: `u${i}`,
      handle: `user${i}`,
      name: `ユーザー${i}`,
    }));
    expect(filterCandidates(many, "user")).toHaveLength(8);
    expect(filterCandidates(many, "user", 3)).toHaveLength(3);
  });
});

describe("applyCompletion", () => {
  it("入力中の語を置き換えて、後ろに空白を足す", () => {
    expect(applyCompletion("やあ @ali", 3, 7, candidates[0])).toEqual({ value: "やあ @alice ", caret: 10 });
  });

  it("キャレットより後ろの文字は残す", () => {
    expect(applyCompletion("@ali よろしく", 0, 4, candidates[0])).toEqual({ value: "@alice  よろしく", caret: 7 });
  });

  it("全員宛てはハンドルではなく種類を入れる", () => {
    expect(applyCompletion("@ch", 0, 3, candidates[2])).toEqual({ value: "@channel ", caret: 9 });
  });
});
