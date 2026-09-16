import { describe, expect, it } from "vitest";

import { avatarColor, avatarInitial } from "./avatar";

describe("avatarColor", () => {
  it("returns the same color for the same ID", () => {
    const id = "01J8Z4X7G5Q2M3N4P5R6S7T8V9";

    expect(avatarColor(id)).toBe(avatarColor(id));
  });

  it("stays within 1 to 6", () => {
    for (let i = 0; i < 500; i++) {
      const color = avatarColor(`01J8Z4X7G5Q2M3N4P5R6S7${i.toString().padStart(4, "0")}`);

      expect(color).toBeGreaterThanOrEqual(1);
      expect(color).toBeLessThanOrEqual(6);
    }
  });

  it("spreads IDs that differ only at the end across all colors", () => {
    // 同じ時期に作られた ULID は先頭がそろうので、末尾の違いだけで散らばることを確かめる
    const colors = new Set(
      Array.from({ length: 60 }, (_, i) => avatarColor(`01J8Z4X7G5Q2M3N4P5R6S7T8${i.toString().padStart(2, "0")}`)),
    );

    expect(colors.size).toBe(6);
  });
});

describe("avatarInitial", () => {
  it.each([
    ["佐藤 直樹", "佐"],
    ["  naoki", "n"],
    ["👩‍💻 dev", "👩"],
    ["", "?"],
    ["   ", "?"],
  ])("%j -> %j", (name, want) => {
    expect(avatarInitial(name)).toBe(want);
  });
});
