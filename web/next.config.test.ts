import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next.config", () => {
  it("Service Worker を HTTP のキャッシュから読ませない（ADR 0069）", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const sw = rules.find((r) => r.source === "/sw.js");
    expect(sw?.headers).toContainEqual({ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" });
  });
});
