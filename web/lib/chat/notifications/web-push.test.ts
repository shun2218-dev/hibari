import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";
import type { PushConfig } from "@/lib/api/types.gen";

import {
  type PushBrowser,
  base64UrlToBytes,
  browserPushSupport,
  createWebPush,
  forgetBrowserPush,
  subscriptionRequest,
} from "./web-push";

// 65 バイトの公開鍵の代わり（中身は見ない。鍵が変わったかの比べ方だけを確かめる）
const KEY = "BAECAwQ";
const OTHER_KEY = "BAUGBwg";

function fakeSubscription(key: string, endpoint = "https://fcm.googleapis.com/fcm/send/abc") {
  return {
    options: { applicationServerKey: base64UrlToBytes(key).buffer },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "p256dh-value", auth: "auth-value" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

type FakeSubscription = ReturnType<typeof fakeSubscription>;

function setup({
  config = { enabled: true, vapid_public_key: KEY },
  permission = "granted",
  requestResult = "granted",
  existing = null,
  browser: overrides = {},
  put = async () => ({ id: "s1", user_agent: "", is_current: true, created_at: "2026-10-20T00:00:00Z" }),
}: {
  config?: PushConfig;
  permission?: NotificationPermission;
  requestResult?: NotificationPermission;
  existing?: FakeSubscription | null;
  browser?: Partial<PushBrowser>;
  put?: () => Promise<unknown>;
} = {}) {
  let current: FakeSubscription | null = existing;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async ({ applicationServerKey }: { applicationServerKey: BufferSource }) => {
      const bytes = new Uint8Array(applicationServerKey as Uint8Array);
      current = fakeSubscription(btoa(String.fromCharCode(...bytes)).replace(/=+$/u, ""));
      current.unsubscribe.mockImplementation(async () => {
        current = null;
        return true;
      });
      return current;
    }),
  };
  existing?.unsubscribe.mockImplementation(async () => {
    current = null;
    return true;
  });
  const registration = { pushManager };
  const notification = {
    permission,
    requestPermission: vi.fn(async () => {
      notification.permission = requestResult;
      return requestResult;
    }),
  };
  const browser: PushBrowser = {
    serviceWorker: { register: vi.fn(async () => registration), getRegistration: vi.fn(async () => registration) },
    pushManager: true,
    notification,
    ios: false,
    standalone: false,
    ...overrides,
  };
  const api = {
    getPushConfig: vi.fn(async () => config),
    putPushSubscription: vi.fn(put),
    deletePushSubscription: vi.fn(async () => {}),
    listPushSubscriptions: vi.fn(async () => ({ subscriptions: [] })),
    deletePushSubscriptionById: vi.fn(async () => {}),
  };
  // putPushSubscription の戻り値の型は API のものだが、テストでは使わない
  const push = createWebPush(api as never, browser);
  return { push, api, browser, pushManager, notification, current: () => current };
}

describe("browserPushSupport", () => {
  const base: PushBrowser = {
    serviceWorker: { register: vi.fn(), getRegistration: vi.fn() },
    pushManager: true,
    notification: { permission: "default", requestPermission: vi.fn() },
    ios: false,
    standalone: false,
  };

  it.each([
    ["揃っていれば使える", {}, "ok"],
    ["Service Worker がない", { serviceWorker: undefined }, "unsupported"],
    ["PushManager がない", { pushManager: false }, "unsupported"],
    ["Notification がない", { notification: undefined }, "unsupported"],
    // iPhone の Safari はホーム画面に追加していないと PushManager がない。それでも「対応していない」ではなく案内を出す
    ["iPhone でホーム画面にない", { ios: true, pushManager: false }, "install"],
    ["iPhone でホーム画面から開いた", { ios: true, standalone: true }, "ok"],
    ["iPhone でホーム画面から開いたが古い iOS", { ios: true, standalone: true, pushManager: false }, "unsupported"],
  ] as const)("%s", (_name, overrides, want) => {
    expect(browserPushSupport({ ...base, ...overrides })).toBe(want);
  });
});

describe("state", () => {
  it("サーバーに鍵がなければ server-disabled（ほかの条件より先。画面は 6.14b のまま）", async () => {
    const { push } = setup({ config: { enabled: false }, browser: { ios: true } });
    expect(await push.state()).toBe("server-disabled");
  });

  it.each([
    ["対応していない", { browser: { pushManager: false } }, "unsupported"],
    ["iPhone でホーム画面にない", { browser: { ios: true, pushManager: false } }, "install"],
    ["拒否されている", { permission: "denied" }, "denied"],
    ["許可がまだ決まっていない", { permission: "default" }, "off"],
    ["許可したが購読していない", { permission: "granted" }, "off"],
  ] as const)("%s → %s", async (_name, options, want) => {
    const { push } = setup(options as Parameters<typeof setup>[0]);
    expect(await push.state()).toBe(want);
  });

  it("購読をサーバーに登録できたら on", async () => {
    const { push } = setup({ existing: fakeSubscription(KEY) });
    await push.resync();
    expect(await push.state()).toBe("on");
  });

  it("設定は 1 度だけ読み、読めなかったら次に読み直す", async () => {
    const { push, api } = setup();
    api.getPushConfig.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(push.state()).rejects.toThrow("fetch failed");
    expect(await push.state()).toBe("off");
    expect(await push.state()).toBe("off");
    expect(api.getPushConfig).toHaveBeenCalledTimes(2);
  });
});

describe("enable", () => {
  it("許可を求めてから購読し、サーバーに登録する", async () => {
    const { push, api, notification, pushManager, browser } = setup({ permission: "default" });
    await push.state();
    const changed = vi.fn();
    push.subscribe(changed);

    expect(await push.enable()).toBe("on");

    expect(notification.requestPermission).toHaveBeenCalledOnce();
    expect(browser.serviceWorker!.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
    expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(KEY) });
    expect(api.putPushSubscription).toHaveBeenCalledWith({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "p256dh-value", auth: "auth-value" },
    });
    expect(push.enabled()).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("許可の要求は、ほかのどの await よりも先に呼ぶ（Safari は操作のあとの await を挟んだ要求を拒む）", async () => {
    const { push, api, notification } = setup({ permission: "default" });
    const order: string[] = [];
    api.getPushConfig.mockImplementation(async () => {
      order.push("config");
      return { enabled: true, vapid_public_key: KEY };
    });
    notification.requestPermission.mockImplementation(async () => {
      order.push("permission");
      notification.permission = "granted";
      return "granted";
    });
    await push.enable();
    expect(order[0]).toBe("permission");
  });

  it("拒否されたら購読しない", async () => {
    const { push, pushManager, api } = setup({ permission: "default", requestResult: "denied" });
    expect(await push.enable()).toBe("denied");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.putPushSubscription).not.toHaveBeenCalled();
    expect(push.enabled()).toBe(false);
  });

  it("確認を閉じた（default のまま）なら off", async () => {
    const { push } = setup({ permission: "default", requestResult: "default" });
    expect(await push.enable()).toBe("off");
  });

  it("サーバーに登録できなければ、ブラウザの購読を外して投げる（次の resync で勝手に有効にならないように）", async () => {
    const { push, current } = setup({ put: async () => Promise.reject(new ApiError(400, { type: "about:blank", title: "x", status: 400 })) });
    await expect(push.enable()).rejects.toBeInstanceOf(ApiError);
    expect(current()).toBeNull();
    expect(push.enabled()).toBe(false);
  });

  it("すでに同じ鍵で購読していれば、作り直さずに登録する", async () => {
    const existing = fakeSubscription(KEY);
    const { push, pushManager, api } = setup({ existing });
    expect(await push.enable()).toBe("on");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.putPushSubscription).toHaveBeenCalledOnce();
  });

  it("サーバーの鍵が変わっていたら、古い購読を外して作り直す", async () => {
    const existing = fakeSubscription(OTHER_KEY);
    const { push, pushManager } = setup({ existing });
    expect(await push.enable()).toBe("on");
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it("対応していなければ何もしない", async () => {
    const { push, notification } = setup({ browser: { pushManager: false } });
    expect(await push.enable()).toBe("unsupported");
    expect(notification.requestPermission).not.toHaveBeenCalled();
  });
});

describe("disable", () => {
  it("サーバーの購読を消してから、ブラウザの購読を外す", async () => {
    const existing = fakeSubscription(KEY);
    const { push, api, current } = setup({ existing });
    await push.resync();
    expect(push.enabled()).toBe(true);

    await push.disable();

    expect(api.deletePushSubscription).toHaveBeenCalledOnce();
    expect(current()).toBeNull();
    expect(push.enabled()).toBe(false);
  });

  it("サーバーで消せなければ投げて、ブラウザの購読も残す", async () => {
    const existing = fakeSubscription(KEY);
    const { push, api, current } = setup({ existing });
    await push.resync();
    api.deletePushSubscription.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(push.disable()).rejects.toThrow("fetch failed");
    expect(current()).toBe(existing);
    expect(push.enabled()).toBe(true);
  });
});

describe("resync（ページを開くたびに PUT し直す。決定 4）", () => {
  it("いまの購読を登録し直す。購読は作らない", async () => {
    const { push, api, pushManager } = setup({ existing: fakeSubscription(KEY, "https://updates.push.services.mozilla.com/wpush/v2/new") });
    await push.resync();
    expect(api.putPushSubscription).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "https://updates.push.services.mozilla.com/wpush/v2/new" }));
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(push.enabled()).toBe(true);
  });

  it("購読がなければ登録しない", async () => {
    const { push, api, pushManager } = setup();
    await push.resync();
    expect(api.putPushSubscription).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(push.enabled()).toBe(false);
  });

  it.each([
    ["サーバーに鍵がない", { config: { enabled: false } }],
    ["許可されていない", { permission: "denied" }],
    ["対応していない", { browser: { pushManager: false } }],
  ] as const)("%s なら Service Worker も登録しない", async (_name, options) => {
    const { push, browser, api } = setup({ ...(options as Parameters<typeof setup>[0]), existing: fakeSubscription(KEY) });
    await push.resync();
    expect(browser.serviceWorker?.register).not.toHaveBeenCalled();
    expect(api.putPushSubscription).not.toHaveBeenCalled();
    expect(push.enabled()).toBe(false);
  });

  it("サーバーの鍵が変わっていたら、購読を作り直して登録する（古い鍵の購読にはもう送れない）", async () => {
    const existing = fakeSubscription(OTHER_KEY);
    const { push, pushManager, api } = setup({ existing });
    await push.resync();
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
    expect(api.putPushSubscription).toHaveBeenCalledOnce();
    expect(push.enabled()).toBe(true);
  });

  it("登録に失敗しても投げず、タブの通知に任せる（購読は次に開いたときにまた試すので残す）", async () => {
    const existing = fakeSubscription(KEY);
    const { push, current } = setup({ existing, put: async () => Promise.reject(new TypeError("fetch failed")) });
    await expect(push.resync()).resolves.toBeUndefined();
    expect(push.enabled()).toBe(false);
    expect(current()).toBe(existing);
  });
});

describe("端末の一覧", () => {
  it("一覧と、ほかの端末の停止は API をそのまま呼ぶ", async () => {
    const { push, api } = setup();
    await push.listDevices();
    await push.stopDevice("s2");
    expect(api.listPushSubscriptions).toHaveBeenCalledOnce();
    expect(api.deletePushSubscriptionById).toHaveBeenCalledWith("s2");
  });
});

describe("forgetBrowserPush（ログアウト）", () => {
  it("このブラウザの購読を外す", async () => {
    const existing = fakeSubscription(KEY);
    const { browser, current } = setup({ existing });
    await forgetBrowserPush(browser.serviceWorker);
    expect(current()).toBeNull();
  });

  it("Service Worker の登録がなくても、ない環境でも終わる", async () => {
    await expect(forgetBrowserPush({ register: vi.fn(), getRegistration: vi.fn(async () => undefined) })).resolves.toBeUndefined();
    await expect(forgetBrowserPush(undefined)).resolves.toBeUndefined();
  });

  it("外せなくても投げない（ログアウトを止めない）", async () => {
    const getRegistration = vi.fn(async () => Promise.reject(new Error("boom")));
    await expect(forgetBrowserPush({ register: vi.fn(), getRegistration })).resolves.toBeUndefined();
  });
});

describe("base64UrlToBytes・subscriptionRequest", () => {
  it("詰め物のない base64url を読む", () => {
    expect([...base64UrlToBytes("-_8")]).toEqual([0xfb, 0xff]);
    expect([...base64UrlToBytes("AQID")]).toEqual([1, 2, 3]);
  });

  it("鍵のない購読は送らない", () => {
    const subscription = { ...fakeSubscription(KEY), toJSON: () => ({ endpoint: "https://x", keys: {} }) };
    expect(subscriptionRequest(subscription)).toBeNull();
  });
});
