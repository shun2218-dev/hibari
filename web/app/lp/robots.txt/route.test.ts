// @vitest-environment node
import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("LP の robots.txt", () => {
  it("すべて読ませ、sitemap の場所を書く", async () => {
    const response = GET();
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe("User-Agent: *\nAllow: /\n\nSitemap: http://lp.localhost:3000/sitemap.xml\n");
  });
});
