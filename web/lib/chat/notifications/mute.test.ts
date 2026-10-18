import { describe, expect, it } from "vitest";

import { isMuted, muteUntilLabel, nextMuteExpiry, temporaryMuteUntil } from "./mute";

// 日付の区切りは端末のタイムゾーン。テストでは Asia/Tokyo の暦で見る
const TZ = "Asia/Tokyo";
const at = (iso: string) => new Date(iso);

describe("isMuted", () => {
  const now = Date.parse("2026-09-22T09:00:00Z");

  it.each([
    ["ミュートしていない", { level: null, muted: false, muted_until: null }, false],
    ["期限なし", { level: null, muted: true, muted_until: null }, true],
    ["期限の前", { level: null, muted: true, muted_until: "2026-09-22T09:00:01Z" }, true],
    ["期限ちょうど（サーバーと同じく、過ぎたものとみなす）", { level: null, muted: true, muted_until: "2026-09-22T09:00:00Z" }, false],
    ["設定を持たない（参加していない public ルーム）", null, false],
  ])("%s", (_name, n, want) => {
    expect(isMuted(n, now)).toBe(want);
  });
});

describe("temporaryMuteUntil", () => {
  it("1 時間はそのまま 1 時間後", () => {
    const now = new Date(2026, 8, 22, 17, 30);
    expect(temporaryMuteUntil("hour", now)).toEqual(new Date(2026, 8, 22, 18, 30));
  });

  it("「明日まで」は明日いっぱい（翌々日の 0:00。オーナーの判断）", () => {
    expect(temporaryMuteUntil("tomorrow", new Date(2026, 8, 22, 23, 50))).toEqual(new Date(2026, 8, 24));
    // 月末をまたいでも暦で数える
    expect(temporaryMuteUntil("tomorrow", new Date(2026, 8, 30, 8, 0))).toEqual(new Date(2026, 9, 2));
  });
});

describe("muteUntilLabel", () => {
  const now = at("2026-09-22T08:30:00+09:00");

  it.each([
    ["今日のうちに切れる", "2026-09-22T18:30:00+09:00", "今日 18:30 まで"],
    ["明日の途中で切れる", "2026-09-23T09:00:00+09:00", "明日 09:00 まで"],
    ["明日いっぱい（翌々日の 0:00）", "2026-09-24T00:00:00+09:00", "明日いっぱい"],
    ["それより先の日付の区切り", "2026-09-30T00:00:00+09:00", "9月29日いっぱい"],
    ["それより先の途中", "2026-09-30T12:00:00+09:00", "9月30日 12:00 まで"],
  ])("%s", (_name, until, want) => {
    expect(muteUntilLabel(at(until), now, TZ)).toBe(want);
  });
});

describe("nextMuteExpiry", () => {
  it("まだ来ていない期限のうち、いちばん早いもの", () => {
    const now = Date.parse("2026-09-22T09:00:00Z");
    const got = nextMuteExpiry(
      [
        { level: null, muted: true, muted_until: "2026-09-22T12:00:00Z" },
        { level: null, muted: true, muted_until: "2026-09-22T10:00:00Z" },
        { level: null, muted: true, muted_until: "2026-09-22T08:00:00Z" },
        { level: null, muted: true, muted_until: null },
        null,
      ],
      now,
    );
    expect(got).toBe(Date.parse("2026-09-22T10:00:00Z"));
    expect(nextMuteExpiry([{ level: null, muted: false, muted_until: null }], now)).toBeNull();
  });
});
