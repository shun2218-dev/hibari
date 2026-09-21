import { describe, expect, it } from "vitest";

import { displayPresence } from "./presence";

describe("displayPresence（ADR 0049）", () => {
  it("見ている接続があればオンライン", () => {
    expect(displayPresence("active", false)).toBe("online");
  });

  it("接続はあるが誰も見ていなければ離席", () => {
    expect(displayPresence("idle", false)).toBe("away");
  });

  it("手動の離席は、見ていても離席にする（本人が戻すまで固定）", () => {
    expect(displayPresence("active", true)).toBe("away");
  });

  it("接続がなければ、手動の離席でもオフライン（いない人を離席中に見せない）", () => {
    expect(displayPresence("offline", true)).toBe("offline");
  });
});
