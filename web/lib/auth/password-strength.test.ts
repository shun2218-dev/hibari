import { describe, expect, it } from "vitest";

import { passwordStrength } from "./password-strength";

describe("passwordStrength", () => {
  it.each([
    ["", undefined],
    ["1234567", 1],
    ["12345678", 2],
    ["12345678901", 2],
    ["correct-horse", 3],
    ["123456789012345", 3],
    ["correct-horse-battery", 4],
  ])("rates %j by length", (password, level) => {
    expect(passwordStrength(password)?.level).toBe(level);
  });

  it("counts code points like the server, not UTF-16 units", () => {
    // 絵文字 1 つは UTF-16 で 2 単位。length で数えると 7 個で 8 文字を超えてしまう
    expect(passwordStrength("🐦".repeat(7))?.level).toBe(1);
    expect(passwordStrength("🐦".repeat(8))?.level).toBe(2);
  });
});
