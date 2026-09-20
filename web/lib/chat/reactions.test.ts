import { describe, expect, it } from "vitest";

import { keepMyReactions, reactionNamesLabel, rgbTriplet, toggleReaction } from "./reactions";

describe("reactionNamesLabel", () => {
  it.each([
    { names: ["高橋 みゆき"], count: 1, want: "高橋 みゆきが 👍 を付けました" },
    { names: ["高橋 みゆき", "佐藤 直樹"], count: 2, want: "高橋 みゆき、佐藤 直樹が 👍 を付けました" },
    // API が返す名前は先頭 8 人まで（ADR 0044）。足りないぶんは人数でまとめる
    { names: ["高橋 みゆき", "佐藤 直樹"], count: 5, want: "高橋 みゆき、佐藤 直樹 他 3 人が 👍 を付けました" },
  ])("names=$names count=$count", ({ names, count, want }) => {
    expect(reactionNamesLabel({ emoji: "👍", count, names })).toBe(want);
  });

  it("falls back to the count when no name could be resolved", () => {
    // 付けた人が全員ルームを抜けたあとなど、ID から名前を引けないとき
    expect(reactionNamesLabel({ emoji: "🎉", count: 3, names: [] })).toBe("3 人が 🎉 を付けました");
  });
});

describe("rgbTriplet", () => {
  it.each([
    ["#2f6f62", "47, 111, 98"],
    ["#ffffff", "255, 255, 255"],
    ["2f6f62", "47, 111, 98"],
    // globals.css の値は 6 桁だが、手で書き足されたときのために 3 桁も読む
    ["#fff", "255, 255, 255"],
    // getComputedStyle は先頭に空白を付けて返すことがある
    ["  #16201d  ", "22, 32, 29"],
  ])("%s -> %s", (input, want) => {
    expect(rgbTriplet(input)).toBe(want);
  });

  it.each(["", "rgb(47 111 98)", "var(--color-primary)", "#12345"])("gives up on %s", (input) => {
    // 読めない値はライブラリの既定色に任せる（変数を設定しない）
    expect(rgbTriplet(input)).toBeUndefined();
  });
});

describe("toggleReaction（楽観的更新。ADR 0044 決定 8）", () => {
  const me = "u-me";
  const other = "u-other";

  it("まだ無い絵文字は、末尾に 1 件として足す", () => {
    expect(toggleReaction([{ emoji: "🎉", count: 1, me: false, users: [other] }], "👍", me, true)).toEqual([
      { emoji: "🎉", count: 1, me: false, users: [other] },
      { emoji: "👍", count: 1, me: true, users: [me] },
    ]);
  });

  it("すでにある絵文字は、数を増やして自分を足す", () => {
    expect(toggleReaction([{ emoji: "👍", count: 1, me: false, users: [other] }], "👍", me, true)).toEqual([
      { emoji: "👍", count: 2, me: true, users: [other, me] },
    ]);
  });

  it("users が 8 人埋まっていたら、数だけ増やす", () => {
    const users = Array.from({ length: 8 }, (_, i) => `u-${i}`);
    const [got] = toggleReaction([{ emoji: "👍", count: 8, me: false, users }], "👍", me, true);
    expect(got).toEqual({ emoji: "👍", count: 9, me: true, users });
  });

  it("外すと数が減り、自分が users から消える", () => {
    expect(toggleReaction([{ emoji: "👍", count: 2, me: true, users: [other, me] }], "👍", me, false)).toEqual([
      { emoji: "👍", count: 1, me: false, users: [other] },
    ]);
  });

  it("自分しか付けていなければ、行ごと消える", () => {
    expect(toggleReaction([{ emoji: "👍", count: 1, me: true, users: [me] }], "👍", me, false)).toEqual([]);
  });

  it("すでにその状態なら、同じ配列をそのまま返す", () => {
    const reactions = [{ emoji: "👍", count: 1, me: true, users: [me] }];
    expect(toggleReaction(reactions, "👍", me, true)).toBe(reactions);
    expect(toggleReaction(reactions, "🎉", me, false)).toBe(reactions);
  });
});

describe("keepMyReactions（配信には me が載らない。ADR 0044 決定 3 の追記）", () => {
  it("me の無い更新では、手元の me を引き継ぐ", () => {
    const previous = [
      { emoji: "👍", count: 1, me: true, users: ["u-me"] },
      { emoji: "🎉", count: 1, me: false, users: ["u-other"] },
    ];
    const incoming = [
      { emoji: "👍", count: 2, users: ["u-me", "u-other"] },
      { emoji: "🎉", count: 1, users: ["u-other"] },
    ];

    expect(keepMyReactions(previous, incoming)).toEqual([
      { emoji: "👍", count: 2, me: true, users: ["u-me", "u-other"] },
      { emoji: "🎉", count: 1, me: false, users: ["u-other"] },
    ]);
  });

  it("手元に無い絵文字は false にする", () => {
    expect(keepMyReactions([], [{ emoji: "👀", count: 1, users: ["u-other"] }])).toEqual([
      { emoji: "👀", count: 1, me: false, users: ["u-other"] },
    ]);
  });

  it("me が入っている（REST の応答）ならそのまま返す", () => {
    const incoming = [{ emoji: "👍", count: 1, me: false, users: ["u-other"] }];
    expect(keepMyReactions([{ emoji: "👍", count: 1, me: true, users: ["u-me"] }], incoming)).toBe(incoming);
  });
});
