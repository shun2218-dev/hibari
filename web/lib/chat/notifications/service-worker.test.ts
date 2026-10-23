// @vitest-environment node
// Service Worker は DOM を持たない。MessageChannel は Node のものを使う
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * public/sw.js（ADR 0069）のテスト。ビルドを通さない素の JS なので、ファイルをそのまま偽の self で読み込み、
 * 純粋な関数とイベントのつなぎの両方を確かめる。
 */

const SOURCE = readFileSync(fileURLToPath(new URL("../../../public/sw.js", import.meta.url)), "utf8");

type Payload = { type: string; title: string; body?: string; tag: string; group_title?: string; url?: string };
type Shown = { title: string; options: NotificationOptions & { renotify?: boolean; data: { type: string; url: string; count: number } } };
type FakeClient = {
  focused: boolean;
  visibilityState: "visible" | "hidden";
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
};

/** 読み込んだ sw.js の関数。 */
type Worker = {
  safePath(url: unknown): string;
  parsePayload(data: unknown): unknown;
  notificationFor(payload: unknown, existing: unknown[]): Shown;
};

function load() {
  const listeners = new Map<string, (event: unknown) => void>();
  // 出ている通知。同じ tag で出すと置き換わる（OS と同じ）
  const shown = new Map<string, Shown & { close: () => void }>();
  const windows: FakeClient[] = [];
  const registration = {
    showNotification: vi.fn(async (title: string, options: Shown["options"]) => {
      shown.set(options.tag!, { title, options, close: () => shown.delete(options.tag!) });
    }),
    getNotifications: vi.fn(async ({ tag }: { tag: string }) =>
      [...shown.values()].filter((n) => n.options.tag === tag).map((n) => ({ data: n.options.data })),
    ),
    pushManager: { subscribe: vi.fn(async () => ({})) },
  };
  const clients = {
    matchAll: vi.fn(async () => windows),
    openWindow: vi.fn(async () => null),
    claim: vi.fn(async () => {}),
  };
  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => {}),
    registration,
    clients,
  };
  const worker = new Function("self", `${SOURCE}\nreturn { safePath, parsePayload, notificationFor };`)(self) as Worker;

  /** イベントを送り、waitUntil に渡された処理が終わるまで待つ。 */
  async function dispatch(type: string, event: Record<string, unknown> = {}) {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }

  async function push(payload: unknown) {
    await dispatch("push", { data: { json: () => payload } });
  }

  async function click(tag: string) {
    const n = shown.get(tag)!;
    await dispatch("notificationclick", { notification: { data: n.options.data, close: n.close } });
  }

  function addWindow(overrides: Partial<FakeClient> & { answers?: boolean } = {}): FakeClient {
    const { answers = true, ...rest } = overrides;
    const client: FakeClient = {
      focused: false,
      visibilityState: "hidden",
      focus: vi.fn(async () => client),
      navigate: vi.fn(async () => client),
      // チャットの画面は、ポートで応える（service-worker-open.ts）
      postMessage: vi.fn((_message: unknown, ports: MessagePort[]) => {
        if (answers) ports[0].postMessage("ok");
      }),
      ...rest,
    };
    windows.push(client);
    return client;
  }

  return { worker, self, registration, clients, shown, dispatch, push, click, addWindow };
}

const channel: Payload = {
  type: "message",
  title: "高橋 みゆき（#デザインレビュー）",
  body: "確認お願いします @佐藤 直樹",
  tag: "r1",
  group_title: "#デザインレビュー",
  url: "/w/ws1/r/r1?m=m1",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("safePath", () => {
  it.each([
    ["/w/ws1/r/r1?m=m1", "/w/ws1/r/r1?m=m1"],
    ["https://evil.example/", "/"],
    ["//evil.example/", "/"],
    ["/\\evil.example/", "/"],
    ["javascript:alert(1)", "/"],
    [undefined, "/"],
  ])("%s → %s", (url, want) => {
    expect(load().worker.safePath(url)).toBe(want);
  });
});

describe("parsePayload", () => {
  it.each([
    ["null", null],
    ["種類が違う", { ...channel, type: "other" }],
    ["tag がない", { ...channel, tag: "" }],
    ["title がない", { ...channel, title: undefined }],
  ])("%s なら null", (_name, data) => {
    expect(load().worker.parsePayload(data)).toBeNull();
  });

  it("group_title がなければ title を使う", () => {
    expect(load().worker.parsePayload({ ...channel, group_title: undefined })).toMatchObject({ groupTitle: channel.title });
  });
});

describe("push", () => {
  it("ペイロードのタイトルと本文で出す。アイコンは hibari のマーク", async () => {
    const sw = load();
    await sw.push(channel);
    expect(sw.registration.showNotification).toHaveBeenCalledWith("高橋 みゆき（#デザインレビュー）", {
      body: "確認お願いします @佐藤 直樹",
      tag: "r1",
      icon: "/notification-icon.png",
      renotify: false,
      data: { type: "message", url: "/w/ws1/r/r1?m=m1", count: 1 },
    });
  });

  it("同じ tag で続いたら 1 つにまとめ、件数と最後の 1 件を出す（docs/ui の「同じルームで続いた」）", async () => {
    const sw = load();
    await sw.push(channel);
    await sw.push({ ...channel, title: "中村 涼（#デザインレビュー）", body: "了解です", url: "/w/ws1/r/r1?m=m2" });
    await sw.push({ ...channel, body: "最後の 1 件", url: "/w/ws1/r/r1?m=m3" });

    expect(sw.shown.size).toBe(1);
    const n = sw.shown.get("r1")!;
    expect(n.title).toBe("#デザインレビュー");
    expect(n.options.body).toBe("新しいメッセージが 3 件あります\n最後の 1 件");
    expect(n.options.renotify).toBe(true);
    // 押したら最後のメッセージへ
    expect(n.options.data).toEqual({ type: "message", url: "/w/ws1/r/r1?m=m3", count: 3 });
  });

  it("tag が違えば別の通知のまま", async () => {
    const sw = load();
    await sw.push(channel);
    await sw.push({ ...channel, tag: "thread-1", title: "中村 涼（#リリース準備 のスレッド）", group_title: "#リリース準備 のスレッド" });
    expect(sw.shown.size).toBe(2);
    expect(sw.shown.get("thread-1")!.options.body).toBe(channel.body);
  });

  it("最後の 1 件の本文が空なら、件数だけ", () => {
    const sw = load();
    const payload = sw.worker.parsePayload({ ...channel, body: "" });
    expect(sw.worker.notificationFor(payload, [{ count: 1 }]).options.body).toBe("新しいメッセージが 2 件あります");
  });

  it("ハドルの呼び出しは「ハドルを始めました」のまま、まとめない", async () => {
    const sw = load();
    const huddle = { type: "huddle", title: "佐藤 直樹", body: "ハドルを始めました", tag: "h1", group_title: "佐藤 直樹", url: "/w/ws1/r/d1" };
    await sw.push(huddle);
    await sw.push(huddle);
    const n = sw.shown.get("h1")!;
    expect(n.title).toBe("佐藤 直樹");
    expect(n.options.body).toBe("ハドルを始めました");
    expect(n.options.data.count).toBe(1);
  });

  it("読めないペイロードでも通知は出す（Chrome は出さないと警告の通知に替える）", async () => {
    const sw = load();
    await sw.dispatch("push", { data: { json: () => JSON.parse("{") } });
    expect(sw.registration.showNotification).toHaveBeenCalledWith("hibari", expect.objectContaining({ icon: "/notification-icon.png" }));
    await sw.dispatch("push", { data: null });
    expect(sw.registration.showNotification).toHaveBeenCalledTimes(2);
  });
});

describe("notificationclick", () => {
  it("開いているタブを前に出し、読み込み直さずにその URL へ移るよう頼む", async () => {
    const sw = load();
    const hidden = sw.addWindow();
    const visible = sw.addWindow({ visibilityState: "visible" });
    await sw.push(channel);

    await sw.click("r1");

    expect(sw.shown.size).toBe(0);
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(visible.focus).toHaveBeenCalledOnce();
    expect(visible.postMessage).toHaveBeenCalledWith({ type: "hibari:open", url: "/w/ws1/r/r1?m=m1" }, expect.any(Array));
    expect(visible.navigate).not.toHaveBeenCalled();
    expect(sw.clients.openWindow).not.toHaveBeenCalled();
  });

  it("フォーカスのあるタブを、見えているだけのタブより先に選ぶ", async () => {
    const sw = load();
    const visible = sw.addWindow({ visibilityState: "visible" });
    const focused = sw.addWindow({ focused: true, visibilityState: "visible" });
    await sw.push(channel);
    await sw.click("r1");
    expect(focused.postMessage).toHaveBeenCalled();
    expect(visible.postMessage).not.toHaveBeenCalled();
  });

  it("ページが応えなければ（チャットの画面ではない）、そのタブで読み込み直して開く", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const sw = load();
    const client = sw.addWindow({ answers: false });
    await sw.push(channel);

    const clicked = sw.click("r1");
    await vi.advanceTimersByTimeAsync(1000);
    await clicked;

    expect(client.navigate).toHaveBeenCalledWith("/w/ws1/r/r1?m=m1");
  });

  it("navigate できないタブ（この Service Worker が受け持っていない）なら、新しく開く", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const sw = load();
    sw.addWindow({ answers: false, navigate: vi.fn(async () => Promise.reject(new TypeError("not controlled"))) });
    await sw.push(channel);

    const clicked = sw.click("r1");
    await vi.advanceTimersByTimeAsync(1000);
    await clicked;

    expect(sw.clients.openWindow).toHaveBeenCalledWith("/w/ws1/r/r1?m=m1");
  });

  it("タブがなければ新しく開く", async () => {
    const sw = load();
    await sw.push(channel);
    await sw.click("r1");
    expect(sw.clients.openWindow).toHaveBeenCalledWith("/w/ws1/r/r1?m=m1");
  });

  it("サイトの外の URL は開かない", async () => {
    const sw = load();
    await sw.push({ ...channel, url: "https://evil.example/" });
    await sw.click("r1");
    expect(sw.clients.openWindow).toHaveBeenCalledWith("/");
  });
});

describe("pushsubscriptionchange", () => {
  it("同じ鍵で購読を作り直す（サーバーへの登録は、ページを開いたときの PUT に任せる）", async () => {
    const sw = load();
    const key = new Uint8Array([4, 1, 2]).buffer;
    await sw.dispatch("pushsubscriptionchange", { oldSubscription: { options: { applicationServerKey: key } }, newSubscription: null });
    expect(sw.registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key });
  });

  it("ブラウザが新しい購読を渡したら、何もしない", async () => {
    const sw = load();
    await sw.dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription: {} });
    expect(sw.registration.pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe("install / activate", () => {
  it("新しい版はすぐに入れ替え、開いているタブを受け持つ", async () => {
    const sw = load();
    await sw.dispatch("install");
    await sw.dispatch("activate");
    expect(sw.self.skipWaiting).toHaveBeenCalled();
    expect(sw.clients.claim).toHaveBeenCalled();
  });
});
