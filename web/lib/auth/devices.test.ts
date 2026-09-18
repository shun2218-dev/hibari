import { describe, expect, it } from "vitest";

import { deviceKind, deviceLabel, formatLastActive, toDeviceView } from "./devices";

const TZ = "Asia/Tokyo";

const chromeMac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const safariIpad =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/604.1";
const edgeWindows =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const firefoxWindows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
const chromeAndroid =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

describe("deviceLabel", () => {
  it.each([
    [chromeMac, "Chrome · macOS"],
    [safariIpad, "Safari · iPadOS"],
    // Edge も Chrome を名乗るので、先に Edge と判定する
    [edgeWindows, "Edge · Windows"],
    [firefoxWindows, "Firefox · Windows"],
    [chromeAndroid, "Chrome · Android"],
    ["hibari/1.2.0 (iOS 18; iPhone 15)", "hibari for iOS · iPhone 15"],
  ])("reads %s", (userAgent, label) => {
    expect(deviceLabel(userAgent)).toBe(label);
  });

  it("falls back to the raw user agent when nothing matches", () => {
    expect(deviceLabel("curl/8.7.1")).toBe("curl/8.7.1");
  });
});

describe("deviceKind", () => {
  it.each([
    [chromeMac, "browser"],
    [safariIpad, "phone"],
    [chromeAndroid, "phone"],
    ["hibari/1.2.0 (iOS 18; iPhone 15)", "phone"],
    ["hibari/1.2.0 (macOS 15; MacBook Air)", "desktop"],
  ] as const)("classifies %s", (userAgent, kind) => {
    expect(deviceKind(userAgent)).toBe(kind);
  });
});

describe("formatLastActive", () => {
  const now = new Date("2026-09-18T12:00:00+09:00");

  it.each([
    ["2026-09-18T11:59:30+09:00", "たった今"],
    ["2026-09-18T11:58:00+09:00", "2分前"],
    ["2026-09-18T09:05:00+09:00", "09:05"],
    ["2026-09-17T18:24:00+09:00", "昨日 18:24"],
    ["2026-09-15T18:24:00+09:00", "3日前"],
    ["2026-09-02T10:00:00+09:00", "9月2日"],
    ["2025-12-31T10:00:00+09:00", "2025年12月31日"],
  ])("writes %s as %s", (at, label) => {
    expect(formatLastActive(new Date(at), now, TZ)).toBe(label);
  });
});

describe("toDeviceView", () => {
  const now = new Date("2026-09-18T12:00:00+09:00");

  it("says 現在アクティブ for the session in use, whatever the timestamp says", () => {
    const view = toDeviceView(
      {
        id: "s-1",
        user_agent: chromeMac,
        current: true,
        started_at: "2026-09-01T00:00:00Z",
        last_used_at: "2026-09-10T00:00:00Z",
      },
      now,
      TZ,
    );

    expect(view).toEqual({ id: "s-1", kind: "browser", name: "Chrome · macOS", lastActiveLabel: "現在アクティブ", current: true });
  });
});
