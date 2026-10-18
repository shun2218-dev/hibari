import { describe, expect, it } from "vitest";

import robots from "./robots";

describe("robots", () => {
  it("読むのは止めない（載せないことは proxy.ts の noindex で伝える）", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/" } });
  });
});
