import { describe, expect, it } from "vitest";

import { invite, member, miyuki, naoki, workspace } from "@/test/chat-data";
import { body, setup } from "@/test/chat-store";
import { type Handler, json } from "@/test/fake-api";

const ws = workspace("ws-1", "山と印刷", { my_role: "owner" });
const roster = [member(naoki, { role: "owner" }), member(miyuki, { role: "member" })];

function setupAdmin(routes: Record<string, Handler> = {}) {
  return setup({
    "GET /api/v1/workspaces": () => json(200, { workspaces: [ws] }),
    "GET /api/v1/workspaces/ws-1/members?limit=200": () => json(200, { members: roster, next_cursor: null }),
    "GET /api/v1/workspaces/ws-1/invites?limit=200": () =>
      json(200, { invites: [invite("i-1"), invite("i-2", { status: "revoked" })], next_cursor: null }),
    ...routes,
  });
}

describe("招待リンク", () => {
  it("adds the workspace to the list when an invite is accepted", async () => {
    const joined = workspace("ws-2", "山と印刷");
    const { store } = setup({
      "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
      "POST /api/v1/invites/abc/accept": () => json(200, { workspace: joined, already_member: false }),
    });
    await store.loadWorkspaces();

    await store.acceptInvite("abc");
    // すでにメンバーだった招待は使用回数を消費せず（ADR 0011）、一覧も増やさない
    await store.acceptInvite("abc");

    expect(store.getSnapshot().workspaces.list.map((w) => w.id)).toEqual(["ws-1", "ws-2"]);
  });

  it("returns the invite code once and never keeps it in the list", async () => {
    const created = { ...invite("i-3"), code: "7Qv2xkR8mA" };
    const { store, api } = setupAdmin({ "POST /api/v1/workspaces/ws-1/invites": () => json(201, created) });
    await store.loadInvites("ws-1");

    const result = await store.createInvite("ws-1", { maxUses: 10, expiresInSeconds: 604800 });

    expect(result.code).toBe("7Qv2xkR8mA");
    expect(body(api.calls.at(-1)!.init)).toEqual({ max_uses: 10, expires_in_seconds: 604800 });
    const list = store.getSnapshot().invites["ws-1"]!.list;
    expect(list.map((i) => i.id)).toEqual(["i-3", "i-2", "i-1"]);
    expect(list[0]).not.toHaveProperty("code");
  });

  it("marks a revoked invite without reloading the list", async () => {
    const { store, requests } = setupAdmin({
      "DELETE /api/v1/workspaces/ws-1/invites/i-1": () => new Response(null, { status: 204 }),
    });
    await store.loadInvites("ws-1");

    await store.revokeInvite("ws-1", "i-1");

    expect(store.getSnapshot().invites["ws-1"]?.list.find((i) => i.id === "i-1")?.status).toBe("revoked");
    expect(requests().filter((p) => p.includes("/invites")).length).toBe(2);
  });
});
