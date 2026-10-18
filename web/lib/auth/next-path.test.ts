import { describe, expect, it } from "vitest";

import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it.each([
    ["/w/01J8ZK3X5R8Q2W4E6T8Y0U2I4O", "/w/01J8ZK3X5R8Q2W4E6T8Y0U2I4O"],
    ["/settings?tab=devices#top", "/settings?tab=devices#top"],
    ["/", "/"],
  ])("keeps the same-origin path %s", (next, want) => {
    expect(safeNextPath(next)).toBe(want);
  });

  it.each([
    ["missing", undefined],
    ["repeated", ["/a", "/b"]],
    ["empty", ""],
    ["absolute URL", "https://evil.example/"],
    ["protocol-relative", "//evil.example/"],
    ["backslash that browsers read as //", "/\\evil.example/"],
    ["javascript URL", "javascript:alert(1)"],
    ["relative path", "w/123"],
    ["login page", "/login?next=/"],
    ["signup page", "/signup"],
  ])("falls back for %s", (_name, next) => {
    expect(safeNextPath(next)).toBe("/");
  });
});
