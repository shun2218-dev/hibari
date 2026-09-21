import { describe, expect, it } from "vitest";

import { filterCandidates, mentionAll, type MentionCandidate } from "./mentions";

const ALICE = "01J8ZZZZZZZZZZZZZZZZZZZZZA";
const BOB = "01J8ZZZZZZZZZZZZZZZZZZZZZB";

const candidates: MentionCandidate[] = [
  { kind: "user", id: ALICE, handle: "alice", name: "田中 あおい" },
  { kind: "user", id: BOB, handle: "bob_2", name: "alice_lookalike" },
  { kind: "channel", description: "このチャンネルの全員" },
  { kind: "here", description: "いまオンラインの人" },
];

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

describe("mentionAll", () => {
  it("全員宛てがなければ null", () => {
    expect(mentionAll(`やあ <@${ALICE}>`)).toBeNull();
    expect(mentionAll("channel の話")).toBeNull();
  });

  it("here だけなら here", () => {
    expect(mentionAll("<!here> 手が空いてる人いる？")).toBe("here");
  });

  it("両方あれば、飛ぶ範囲が広い channel", () => {
    expect(mentionAll("<!here> と <!channel>")).toBe("channel");
    expect(mentionAll("<!channel> と <!here>")).toBe("channel");
  });
});

describe("mentionAll のコード（ADR 0051 決定 5）", () => {
  it("コードの中の全員宛てでは確認を出さない", () => {
    expect(mentionAll("`<!channel>` と ```<!here>```")).toBeNull();
    expect(mentionAll("`<!channel>` と <!here>")).toBe("here");
  });
});
