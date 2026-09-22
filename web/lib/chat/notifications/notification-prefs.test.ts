import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BANNER_DISMISSED_KEY,
  bannerDismissed,
  dismissBanner,
  notificationPermission,
  requestNotificationPermission,
  setSoundEnabled,
  soundEnabled,
  subscribeNotificationPrefs,
} from "./notification-prefs";

describe("notification-prefs（ADR 0057 決定 5・6）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Notification のない環境は unsupported", () => {
    expect(notificationPermission()).toBe("unsupported");
  });

  it("許可を求めたら、購読者に知らせる", async () => {
    const Notification = Object.assign(vi.fn(), { permission: "default", requestPermission: vi.fn(async () => "granted") });
    vi.stubGlobal("Notification", Notification);
    const listener = vi.fn();
    const unsubscribe = subscribeNotificationPrefs(listener);

    expect(notificationPermission()).toBe("default");
    await requestNotificationPermission();

    expect(Notification.requestPermission).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("帯を閉じたことと通知音を、この端末に覚える。通知音の既定はオン", () => {
    expect(bannerDismissed()).toBe(false);
    dismissBanner();
    expect(window.localStorage.getItem(BANNER_DISMISSED_KEY)).toBe("1");
    expect(bannerDismissed()).toBe(true);

    expect(soundEnabled()).toBe(true);
    setSoundEnabled(false);
    expect(soundEnabled()).toBe(false);
  });

  it("localStorage が使えなくても、既定の値で動く", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(bannerDismissed()).toBe(false);
    expect(soundEnabled()).toBe(true);
  });
});
