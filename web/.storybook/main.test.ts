// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import config from "./main";

describe("Storybook の robots.txt（ADR 0063 決定 5）", () => {
  it("static/ をルートに出し、robots.txt ですべて Disallow にする", () => {
    expect(config.staticDirs).toContainEqual({ from: "./static", to: "/" });
    const robots = readFileSync(new URL("./static/robots.txt", import.meta.url), "utf8");
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Disallow: \/$/m);
  });
});
