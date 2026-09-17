import { describe, expect, it } from "vitest";

import { dayKey, formatBytes, formatDate, formatListTime, formatTime } from "./format";

const tz = "Asia/Tokyo";

describe("formatTime / formatDate / dayKey", () => {
  it("uses the viewer's time zone, not UTC", () => {
    // UTC では 9 月 12 日の 15:05、東京では 9 月 13 日の 00:05
    const date = new Date("2026-09-12T15:05:00Z");

    expect(formatTime(date, tz)).toBe("00:05");
    expect(formatDate(date, tz)).toBe("2026年9月13日");
    expect(dayKey(date, tz)).toBe("2026-9-13");
    expect(dayKey(date, "UTC")).toBe("2026-9-12");
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
