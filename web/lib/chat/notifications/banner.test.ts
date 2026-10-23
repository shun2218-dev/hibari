import { describe, expect, it } from "vitest";

import { notificationBannerKind } from "./banner";

describe("notificationBannerKind（ADR 0057 決定 5、ADR 0069 決定 1・2・9）", () => {
  it.each([
    // プッシュの状態, 許可, 出す帯
    ["off", "default", "push"],
    ["off", "granted", null],
    ["install", "unsupported", "install"],
    ["install", "default", "install"],
    ["server-disabled", "default", "desktop"],
    ["server-disabled", "granted", null],
    ["server-disabled", "unsupported", null],
    ["unsupported", "default", "desktop"],
    ["unsupported", "unsupported", null],
    ["denied", "denied", null],
    ["on", "granted", null],
    ["loading", "default", null],
    [null, "default", "desktop"],
    [null, "denied", null],
  ] as const)("プッシュ %s・許可 %s → %s", (push, permission, kind) => {
    expect(notificationBannerKind({ push, permission, dismissed: false })).toBe(kind);
  });

  it.each(["off", "install", "server-disabled", "unsupported", null] as const)(
    "「今はしない」で閉じたら、種類によらず出さない（プッシュ %s）",
    (push) => {
      expect(notificationBannerKind({ push, permission: "default", dismissed: true })).toBeNull();
    },
  );
});
