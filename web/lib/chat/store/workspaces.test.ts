import { describe, expect, it } from "vitest";

import { invite, member, miyuki, naoki, workspace } from "@/test/chat-data";
import { setup } from "@/test/chat-store";
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

describe("ワークスペース", () => {
  it("loads workspaces once even if asked twice at the same time", async () => {
    const { store, requests } = setup({
      "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
    });

    await Promise.all([store.loadWorkspaces(), store.loadWorkspaces()]);

    expect(requests()).toEqual(["GET /api/v1/workspaces"]);
    expect(store.getSnapshot().workspaces).toEqual({ status: "ready", list: [workspace("ws-1", "hibari 開発")] });
  });

  it("drops the workspace when I leave it myself", async () => {
    const { store } = setupAdmin({ [`DELETE /api/v1/workspaces/ws-1/members/${naoki.id}`]: () => new Response(null, { status: 204 }) });
    await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

    await store.removeMember("ws-1", naoki.id);

    expect(store.getSnapshot().workspaces.list).toEqual([]);
    expect(store.getSnapshot().removedWorkspaces["ws-1"]?.reason).toBe("left");
  });
});
