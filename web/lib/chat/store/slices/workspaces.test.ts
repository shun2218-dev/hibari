import { describe, expect, it, vi } from "vitest";

import { invite, member, miyuki, naoki, room, roomMember, workspace } from "@/test/chat-data";
import { setup, body, page, me } from "@/test/chat-store";
import { type Handler, json, problem } from "@/test/fake-api";

describe("ワークスペースとメンバー", () => {
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

  it("loads workspaces once even if asked twice at the same time", async () => {
    const { store, requests } = setup({
      "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
    });

    await Promise.all([store.loadWorkspaces(), store.loadWorkspaces()]);

    expect(requests()).toEqual(["GET /api/v1/workspaces"]);
    expect(store.getSnapshot().workspaces).toEqual({ status: "ready", list: [workspace("ws-1", "hibari 開発")] });
  });

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

  describe("members and presence", () => {
    it("updates presence in DM peers and loaded member lists", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () =>
          json(200, { rooms: [room("dm", "", { kind: "dm", name: null, dm_peer: { ...miyuki, presence: "offline" } })] }),
        "GET /api/v1/rooms/r1/members?limit=200": () =>
          json(200, { members: [roomMember(miyuki), roomMember(naoki, { presence: "active" })], next_cursor: null }),
      });
      await store.loadRooms("ws-1");
      await store.loadRoomMembers("r1");
      const untouched = store.getSnapshot().roomMembers.r1!.members[1];

      store.applyEvent({ type: "presence.changed", data: { user_id: miyuki.id, presence: "active" } });

      const state = store.getSnapshot();
      expect(state.rooms.dm?.dm_peer?.presence).toBe("active");
      expect(state.roomMembers.r1?.members[0].presence).toBe("active");
      expect(state.roomMembers.r1?.members[1]).toBe(untouched);
    });

    it("reloads a loaded member list and the member count when someone joins, and removes those who left", async () => {
      let members = [roomMember(miyuki)];
      const { store } = setup({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { member_count: members.length })),
        "GET /api/v1/rooms/r1/messages?limit=50": () => page([], 0),
        "GET /api/v1/rooms/r1/members?limit=200": () => json(200, { members, next_cursor: null }),
      });
      await store.openRoom("r1");
      await store.loadRoomMembers("r1");

      members = [roomMember(miyuki), roomMember(naoki)];
      store.applyEvent({ type: "member.joined", data: { workspace_id: "ws-1", room_id: "r1", user: { ...miyuki, id: "other" } } });
      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1?.member_count).toBe(2));
      expect(store.getSnapshot().roomMembers.r1?.members).toHaveLength(2);

      members = [roomMember(naoki)];
      store.applyEvent({ type: "member.left", data: { workspace_id: "ws-1", room_id: "r1", user_id: miyuki.id } });
      expect(store.getSnapshot().roomMembers.r1?.members.map((m) => m.user.id)).toEqual([naoki.id]);
      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1?.member_count).toBe(1));
    });

    it("adds a room I was added to from elsewhere to the list", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () =>
          json(200, { rooms: [room("r-new", "新しい", { last_message_at: "2026-09-13T03:00:00Z" }), room("r-quiet", "静か")] }),
        "GET /api/v1/rooms/r-added": () =>
          json(200, room("r-added", "追加された", { kind: "private", last_message_at: "2026-09-13T02:00:00Z" })),
      });
      await store.loadRooms("ws-1");

      store.applyEvent({ type: "member.joined", data: { workspace_id: "ws-1", room_id: "r-added", user: naoki } });

      await vi.waitFor(() => expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r-new", "r-added", "r-quiet"]));
    });

    it("updates roles in member lists and my role in the workspace", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
        "GET /api/v1/rooms/r1/members?limit=200": () => json(200, { members: [roomMember(naoki)], next_cursor: null }),
      });
      await Promise.all([store.loadWorkspaces(), store.loadRooms("ws-1"), store.loadRoomMembers("r1")]);

      store.applyEvent({ type: "workspace.role_changed", data: { workspace_id: "ws-1", user_id: me, role: "admin" } });

      expect(store.getSnapshot().workspaces.list[0].my_role).toBe("admin");
      expect(store.getSnapshot().roomMembers.r1?.members[0].role).toBe("admin");
    });

    it("renames rooms and workspaces", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      });
      await Promise.all([store.loadWorkspaces(), store.loadRooms("ws-1")]);

      store.applyEvent({ type: "room.updated", data: { workspace_id: "ws-1", room_id: "r1", name: "雑談 改", is_default: true, archived_at: null } });
      store.applyEvent({ type: "workspace.updated", data: { workspace_id: "ws-1", name: "hibari", invite_policy: "all_members" } });

      expect(store.getSnapshot().rooms.r1).toMatchObject({ name: "雑談 改", is_default: true });
      expect(store.getSnapshot().workspaces.list[0]).toMatchObject({ name: "hibari", invite_policy: "all_members" });
    });
  });

  it("follows the cursor to load every member, and keeps the invites newest first", async () => {
    const { store, requests } = setupAdmin({
      "GET /api/v1/workspaces/ws-1/members?limit=200": () => json(200, { members: [roster[0]], next_cursor: naoki.id }),
      [`GET /api/v1/workspaces/ws-1/members?limit=200&after=${naoki.id}`]: () =>
        json(200, { members: [roster[1]], next_cursor: null }),
    });

    await Promise.all([store.loadMembers("ws-1"), store.loadMembers("ws-1"), store.loadInvites("ws-1")]);

    expect(store.getSnapshot().members["ws-1"]).toEqual({ status: "ready", list: roster });
    // 同じ取得は 2 本送らない（ページの 2 本目は別の URL）
    expect(requests().filter((p) => p.includes("/members")).length).toBe(2);
    expect(store.getSnapshot().invites["ws-1"]?.list.map((i) => i.id)).toEqual(["i-2", "i-1"]);
  });

  it("marks the member list as not_found when the workspace cannot be read", async () => {
    const { store } = setupAdmin({ "GET /api/v1/workspaces/ws-1/members?limit=200": () => problem(404, "not-found") });

    await store.loadMembers("ws-1");

    expect(store.getSnapshot().members["ws-1"]?.status).toBe("not_found");
  });

  it("changes a role and keeps my own role in the workspace list", async () => {
    const { store, api } = setupAdmin({
      [`PATCH /api/v1/workspaces/ws-1/members/${miyuki.id}`]: () => json(200, member(miyuki, { role: "admin" })),
      [`PATCH /api/v1/workspaces/ws-1/members/${naoki.id}`]: () => json(200, member(naoki, { role: "admin" })),
    });
    await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

    await store.changeMemberRole("ws-1", miyuki.id, "admin");
    expect(body(api.calls.at(-1)!.init)).toEqual({ role: "admin" });
    expect(store.getSnapshot().members["ws-1"]?.list.map((m) => m.role)).toEqual(["owner", "admin"]);
    expect(store.getSnapshot().workspaces.list[0].my_role).toBe("owner");

    await store.changeMemberRole("ws-1", naoki.id, "admin");
    expect(store.getSnapshot().workspaces.list[0].my_role).toBe("admin");
  });

  it("removes a kicked member from the list", async () => {
    const { store } = setupAdmin({ [`DELETE /api/v1/workspaces/ws-1/members/${miyuki.id}`]: () => new Response(null, { status: 204 }) });
    await store.loadMembers("ws-1");

    await store.removeMember("ws-1", miyuki.id);

    expect(store.getSnapshot().members["ws-1"]?.list.map((m) => m.user.id)).toEqual([naoki.id]);
  });

  it("drops the workspace when I leave it myself", async () => {
    const { store } = setupAdmin({ [`DELETE /api/v1/workspaces/ws-1/members/${naoki.id}`]: () => new Response(null, { status: 204 }) });
    await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

    await store.removeMember("ws-1", naoki.id);

    expect(store.getSnapshot().workspaces.list).toEqual([]);
    expect(store.getSnapshot().removedWorkspaces["ws-1"]?.reason).toBe("left");
  });

  it("swaps the roles locally when ownership is transferred (the response has no body)", async () => {
    const { store, api } = setupAdmin({
      "POST /api/v1/workspaces/ws-1/ownership-transfer": () => new Response(null, { status: 204 }),
    });
    await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

    await store.transferOwnership("ws-1", miyuki.id);

    expect(body(api.calls.at(-1)!.init)).toEqual({ user_id: miyuki.id });
    expect(store.getSnapshot().members["ws-1"]?.list.map((m) => [m.user.id, m.role])).toEqual([
      [naoki.id, "admin"],
      [miyuki.id, "owner"],
    ]);
    expect(store.getSnapshot().workspaces.list[0].my_role).toBe("admin");
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

  it("applies role changes, removals and presence from events", async () => {
    const { store } = setupAdmin();
    await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

    store.applyEvent({ type: "workspace.role_changed", data: { workspace_id: "ws-1", user_id: miyuki.id, role: "admin" } });
    store.applyEvent({ type: "presence.changed", data: { user_id: miyuki.id, presence: "active" } });
    expect(store.getSnapshot().members["ws-1"]?.list[1]).toMatchObject({ role: "admin", presence: "active" });

    store.applyEvent({
      type: "workspace.member_removed",
      data: { workspace_id: "ws-1", user_id: miyuki.id, reason: "removed" },
    });
    expect(store.getSnapshot().members["ws-1"]?.list.map((m) => m.user.id)).toEqual([naoki.id]);
  });

  // 離席とカスタムステータス（ADR 0049）
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

  it("reloads the members when someone the list does not know joins a room", async () => {
    let listed = [roster[0]];
    const { store, requests } = setupAdmin({
      "GET /api/v1/workspaces/ws-1/members?limit=200": () => json(200, { members: listed, next_cursor: null }),
    });
    const loads = () => requests().filter((p) => p.includes("/members")).length;
    await store.loadMembers("ws-1");
    listed = roster;

    store.applyEvent({ type: "member.joined", data: { workspace_id: "ws-1", room_id: "r-1", user: miyuki } });
    await vi.waitFor(() => expect(store.getSnapshot().members["ws-1"]?.list).toHaveLength(2));
    expect(loads()).toBe(2);

    // すでに一覧にいる人が別のルームに参加しただけなら、取り直さない
    store.applyEvent({ type: "member.joined", data: { workspace_id: "ws-1", room_id: "r-2", user: miyuki } });
    await vi.waitFor(() => expect(loads()).toBe(2));
  });
  // 絵文字のリアクション（ADR 0044）。
});
