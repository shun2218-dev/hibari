import { afterEach, describe, expect, it, vi } from "vitest";

import { createSession } from "@/lib/auth/session";
import { type Handler, TEST_API_BASE, fakeApi, json, problem, tokens } from "@/test/fake-api";

import { createChatApi } from "@/lib/chat/api";
import { createMediaStore } from "./media";

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-09-17T00:00:00Z");

function setup(routes: Record<string, Handler>) {
  const api = fakeApi({ "POST /api/v1/auth/refresh": () => tokens("at-1"), ...routes });
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  let now = T0;
  const media = createMediaStore(createChatApi(session.request), { now: () => now });
  return {
    api,
    media,
    requests: () => api.calls.filter((c) => !c.path.includes("/auth/")),
    advance: (ms: number) => (now += ms),
  };
}

function signed(url: string, expiresAt: number) {
  return { url, expires_at: new Date(expiresAt).toISOString() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("avatars", () => {
  it("batches the users asked for in the same tick into one request", async () => {
    const { media, requests } = setup({
      "POST /api/v1/users/avatars": () =>
        json(200, { avatars: { u1: signed("https://storage.test/u1", T0 + HOUR) } }),
    });

    media.requestAvatars(["u1", "u2"]);
    media.requestAvatars(["u2", "u3"]);

    await vi.waitFor(() => expect(media.getSnapshot().avatars).toEqual({ u1: "https://storage.test/u1", u2: null, u3: null }));
    expect(requests().map((c) => JSON.parse(c.init.body as string))).toEqual([{ user_ids: ["u1", "u2", "u3"] }]);
  });

  it("splits more than 200 users into several requests", async () => {
    const { media, requests } = setup({ "POST /api/v1/users/avatars": () => json(200, { avatars: {} }) });
    const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);

    media.requestAvatars(ids);

    await vi.waitFor(() => expect(Object.keys(media.getSnapshot().avatars)).toHaveLength(250));
    expect(requests().map((c) => JSON.parse(c.init.body as string).user_ids.length)).toEqual([200, 50]);
  });

  it("does not ask again until the url is close to expiring", async () => {
    let version = 0;
    const { media, requests, advance } = setup({
      "POST /api/v1/users/avatars": () =>
        json(200, { avatars: { u1: signed(`https://storage.test/u1?v=${++version}`, T0 + HOUR * version) } }),
    });

    media.requestAvatars(["u1"]);
    await vi.waitFor(() => expect(media.getSnapshot().avatars.u1).toBe("https://storage.test/u1?v=1"));

    advance(50 * 60 * 1000);
    media.requestAvatars(["u1"]);
    await Promise.resolve();
    expect(requests()).toHaveLength(1);

    // 期限（1 時間）まで 5 分を切った
    advance(6 * 60 * 1000);
    media.requestAvatars(["u1"]);
    await vi.waitFor(() => expect(media.getSnapshot().avatars.u1).toBe("https://storage.test/u1?v=2"));
    expect(requests()).toHaveLength(2);
  });

  it("does not ask for users whose request is still in flight", async () => {
    let respond!: () => void;
    const { media, requests } = setup({
      "POST /api/v1/users/avatars": () => new Promise((r) => (respond = () => r(json(200, { avatars: {} })))),
    });

    media.requestAvatars(["u1"]);
    await vi.waitFor(() => expect(requests()).toHaveLength(1));
    media.requestAvatars(["u1"]);
    await Promise.resolve();
    respond();

    await vi.waitFor(() => expect(media.getSnapshot().avatars.u1).toBeNull());
    expect(requests()).toHaveLength(1);
  });

  it("keeps the initials and asks again next time when the request fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const { media, requests } = setup({
      "POST /api/v1/users/avatars": () =>
        fail ? problem(500, "internal") : json(200, { avatars: { u1: signed("https://storage.test/u1", T0 + HOUR) } }),
    });

    media.requestAvatars(["u1"]);
    await vi.waitFor(() => expect(requests()).toHaveLength(1));
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(media.getSnapshot().avatars.u1).toBeUndefined();

    fail = false;
    media.requestAvatars(["u1"]);
    await vi.waitFor(() => expect(media.getSnapshot().avatars.u1).toBe("https://storage.test/u1"));
  });
});

describe("attachment images", () => {
  it("fetches each image url once", async () => {
    const { media, requests } = setup({
      "GET /api/v1/attachments/a1/url": () => json(200, signed("https://storage.test/a1", T0 + 5 * 60 * 1000)),
      "GET /api/v1/attachments/a2/url": () => problem(404, "not-found"),
    });

    media.requestAttachmentUrls(["a1", "a2"]);
    media.requestAttachmentUrls(["a1"]);

    await vi.waitFor(() => expect(media.getSnapshot().attachments).toEqual({ a1: "https://storage.test/a1", a2: null }));
    media.requestAttachmentUrls(["a1", "a2"]);
    expect(requests().map((c) => c.path)).toEqual(["/api/v1/attachments/a1/url", "/api/v1/attachments/a2/url"]);
  });

  it("fetches a new url when an old one fails to load, but gives up on one that fails right away", async () => {
    let version = 0;
    const { media, requests, advance } = setup({
      "GET /api/v1/attachments/a1/url": () =>
        json(200, signed(`https://storage.test/a1?v=${++version}`, T0 + 5 * 60 * 1000)),
    });
    media.requestAttachmentUrls(["a1"]);
    await vi.waitFor(() => expect(media.getSnapshot().attachments.a1).toBe("https://storage.test/a1?v=1"));

    // 期限（5 分）を過ぎてから表示した画像が読み込めなかった
    advance(6 * 60 * 1000);
    media.attachmentImageFailed("a1", "https://storage.test/a1?v=1");
    await vi.waitFor(() => expect(media.getSnapshot().attachments.a1).toBe("https://storage.test/a1?v=2"));

    // 古い URL の失敗が遅れて届いても、新しい URL は捨てない
    media.attachmentImageFailed("a1", "https://storage.test/a1?v=1");
    expect(media.getSnapshot().attachments.a1).toBe("https://storage.test/a1?v=2");

    // 取り直した直後の URL でも読み込めない。取り直しても同じなので諦める
    advance(1000);
    media.attachmentImageFailed("a1", "https://storage.test/a1?v=2");
    expect(media.getSnapshot().attachments.a1).toBeNull();
    expect(requests()).toHaveLength(2);
  });

  it("fetches a fresh url for every download", async () => {
    let version = 0;
    const { media } = setup({
      "GET /api/v1/attachments/a2/url": () => json(200, signed(`https://storage.test/a2?v=${++version}`, T0)),
    });

    expect(await media.attachmentDownloadUrl("a2")).toBe("https://storage.test/a2?v=1");
    expect(await media.attachmentDownloadUrl("a2")).toBe("https://storage.test/a2?v=2");
  });
});
