import { describe, expect, it } from "vitest";

import { displayPresence, displayStatus } from "./presence";

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

describe("displayStatus（ADR 0067 決定 4）", () => {
  const custom = { emoji: "🍵", text: "休憩中" };
  it.each([
    { name: "ステータスがあれば、ハドル中でもステータスのまま（上書きしない）", status: custom, inHuddle: true, want: custom },
    { name: "ステータスがあり、ハドル中でない", status: custom, inHuddle: false, want: custom },
    { name: "ステータスがなく、ハドル中なら 🎧", status: null, inHuddle: true, want: { emoji: "🎧", text: "ハドルミーティング中" } },
    { name: "どちらもなければ出さない", status: undefined, inHuddle: false, want: undefined },
  ])("$name", ({ status, inHuddle, want }) => {
    expect(displayStatus(status, inHuddle)).toEqual(want);
  });
});
