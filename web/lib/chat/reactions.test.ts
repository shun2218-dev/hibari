import { describe, expect, it } from "vitest";

import { reactionNamesLabel, rgbTriplet } from "./reactions";

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
