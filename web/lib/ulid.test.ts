import { describe, expect, it } from "vitest";

import { ulid } from "./ulid";

describe("ulid", () => {
  it("encodes the time in the first 10 characters", () => {
    // oklog/ulid の README の例と同じ時刻（1469918176385 → 01ARYZ6S41）
    expect(ulid(1469918176385, () => new Uint8Array(16)).slice(0, 10)).toBe("01ARYZ6S41");
    expect(ulid(0, () => new Uint8Array(16))).toBe("0".repeat(26));
  });

  it("uses Crockford's base32 for the random part", () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i * 2 + 255 * (i % 2));
    const id = ulid(0, () => bytes);
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("gives different values each time with the real random source", () => {
    const ids = new Set(Array.from({ length: 100 }, () => ulid()));
    expect(ids.size).toBe(100);
  });
});
