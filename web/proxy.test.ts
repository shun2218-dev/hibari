// @vitest-environment node
import { describe, expect, it } from "vitest";

import { config, proxy, ROBOTS_TAG } from "./proxy";

describe("proxy", () => {
  it("X-Robots-Tag: noindex を付ける", () => {
    expect(proxy().headers.get("X-Robots-Tag")).toBe(ROBOTS_TAG);
    expect(ROBOTS_TAG).toContain("noindex");
  });

  it.each([
    ["/login", true],
    ["/j/abcdefghijklmnopqrstuv", true],
    ["/w/ws-1/r/r-1", true],
    ["/robots.txt", true],
    ["/_next/static/chunks/main.js", false],
    ["/_next/image", false],
  ])("%s を通すか: %s", (path, want) => {
    const [pattern] = config.matcher;
    expect(new RegExp(`^${pattern}$`).test(path)).toBe(want);
  });
});
