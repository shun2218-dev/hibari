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

describe("本人が選んだ設定（ADR 0049）", () => {
  describe("本人が選んだ設定", () => {
    it("member.status_changed を、そのワークスペースのメンバーの行に当てる", async () => {
      const { store } = setupAdmin();
      await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

      store.applyEvent({
        type: "member.status_changed",
        data: {
          workspace_id: "ws-1",
          user_id: miyuki.id,
          away: true,
          status: { emoji: "🍵", text: "休憩中", expires_at: null },
        },
      });

      expect(store.getSnapshot().members["ws-1"]?.list[1]).toMatchObject({
        away: true,
        status: { emoji: "🍵", text: "休憩中" },
      });
    });

    it("別のワークスペースには away だけを当てる（ステータスはワークスペースごと）", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces": () => json(200, { workspaces: [ws] }),
        "GET /api/v1/workspaces/ws-1/members?limit=200": () => json(200, { members: roster, next_cursor: null }),
        "GET /api/v1/workspaces/ws-2/members?limit=200": () => json(200, { members: roster, next_cursor: null }),
      });
      await Promise.all([store.loadMembers("ws-1"), store.loadMembers("ws-2")]);

      store.applyEvent({
        type: "member.status_changed",
        data: { workspace_id: "ws-1", user_id: miyuki.id, away: true, status: { emoji: "🍵", text: "", expires_at: null } },
      });

      const state = store.getSnapshot();
      expect(state.members["ws-1"]?.list[1]).toMatchObject({ away: true, status: { emoji: "🍵" } });
      // away はユーザーごとなので当たるが、ステータスは当たらない
      expect(state.members["ws-2"]?.list[1]).toMatchObject({ away: true, status: null });
    });

    it("自分で離席にすると手元で先に反映し、失敗したら戻す", async () => {
      let fail = false;
      const { store } = setupAdmin({
        "PUT /api/v1/users/me/presence": () => (fail ? json(500, {}) : json(200, { away: true })),
      });
      await store.loadMembers("ws-1");

      await store.setAway(true);
      expect(store.getSnapshot().members["ws-1"]?.list[0]).toMatchObject({ away: true });

      fail = true;
      await expect(store.setAway(false)).rejects.toThrow();
      expect(store.getSnapshot().members["ws-1"]?.list[0]).toMatchObject({ away: true });
    });

    it("ステータスの設定と解除も手元で先に反映する", async () => {
      const { store } = setupAdmin({
        "PUT /api/v1/workspaces/ws-1/me/status": () => json(200, { emoji: "🍵", text: "休憩中", expires_at: null }),
        "DELETE /api/v1/workspaces/ws-1/me/status": () => json(204, undefined),
      });
      await store.loadMembers("ws-1");

      await store.setStatus("ws-1", { emoji: "🍵", text: "休憩中", expires_at: null });
      expect(store.getSnapshot().members["ws-1"]?.list[0]).toMatchObject({ status: { emoji: "🍵", text: "休憩中" } });

      await store.setStatus("ws-1", null);
      expect(store.getSnapshot().members["ws-1"]?.list[0]).toMatchObject({ status: null });
    });
  });
});
