import { describe, expect, it } from "vitest";

import { dayKey, formatBytes, formatDate, formatDayLabel, formatListTime, formatTime } from "./time";

const tz = "Asia/Tokyo";

describe("formatTime / formatDate / dayKey", () => {
  it("uses the viewer's time zone, not UTC", () => {
    // UTC では 9 月 12 日の 15:05、東京では 9 月 13 日の 00:05
    const date = new Date("2026-09-12T15:05:00Z");

    expect(formatTime(date, tz)).toBe("00:05");
    expect(dayKey(date, tz)).toBe("2026-9-13");
    expect(dayKey(date, "UTC")).toBe("2026-9-12");
  });
});

describe("formatDate", () => {
  it.each([
    // 今年は年を省く
    ["this year omits the year", "2026-09-12T15:05:00Z", "2026-09-24T03:00:00Z", "9月13日"],
    ["last year shows the year", "2025-09-13T03:00:00Z", "2026-09-24T03:00:00Z", "2025年9月13日"],
    // 年をまたぐ境目。東京の 12/31 と、元日から見た前日
    ["new year's eve seen on new year's eve", "2026-12-31T14:00:00Z", "2026-12-31T14:30:00Z", "12月31日"],
    ["new year's eve seen on new year's day", "2026-12-31T14:00:00Z", "2026-12-31T15:00:00Z", "2026年12月31日"],
    ["new year's day seen on new year's day", "2026-12-31T15:00:00Z", "2026-12-31T15:30:00Z", "1月1日"],
    // 「今年」は UTC ではなく見る人の暦で決める（UTC ではまだ 2026 年の 12/31）
    ["the year is the viewer's, not UTC's", "2026-12-31T16:00:00Z", "2026-12-31T16:00:00Z", "1月1日"],
  ])("%s", (_, iso, nowIso, want) => {
    expect(formatDate(new Date(iso), new Date(nowIso), tz)).toBe(want);
  });
});

describe("formatListTime", () => {
  const now = new Date("2026-09-13T02:00:00Z"); // 東京で 9 月 13 日 11:00

  it.each([
    ["today shows the time", "2026-09-13T00:30:00Z", "09:30"],
    ["just after midnight today", "2026-09-12T15:00:00Z", "00:00"],
    ["yesterday by the calendar, not 24 hours", "2026-09-12T14:59:00Z", "昨日"],
    ["earlier this year shows month and day", "2026-01-02T03:00:00Z", "1月2日"],
    ["last year shows the year", "2025-12-30T03:00:00Z", "2025年12月30日"],
  ])("%s", (_, iso, want) => {
    expect(formatListTime(new Date(iso), now, tz)).toBe(want);
  });

  it("treats the last day of the previous month as yesterday", () => {
    expect(formatListTime(new Date("2026-08-31T03:00:00Z"), new Date("2026-09-01T03:00:00Z"), tz)).toBe("昨日");
  });
});

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [1024, "1 KB"],
    [253_952, "248 KB"],
    [1_887_437, "1.8 MB"],
  ])("%d bytes", (bytes, want) => {
    expect(formatBytes(bytes)).toBe(want);
  });
});

describe("formatDayLabel（アクティビティの日付の区切り）", () => {
  const tz = "Asia/Tokyo";
  const now = new Date("2026-09-22T03:00:00Z"); // 東京の 9 月 22 日 12:00

  it.each([
    ["2026-09-21T16:00:00Z", "今日"], // 東京の 22 日 01:00
    ["2026-09-21T14:59:00Z", "昨日"], // 東京の 21 日 23:59
    ["2026-08-10T03:00:00Z", "8月10日"],
    ["2025-12-31T03:00:00Z", "2025年12月31日"],
  ])("%s → %s", (iso, want) => {
    expect(formatDayLabel(new Date(iso), now, tz)).toBe(want);
  });
});

