import { describe, expect, it } from "vitest";

import { message, miyuki, naoki, room, roomMember, workspace } from "@/test/chat-data";
import { setup, body, opened, me } from "@/test/chat-store";
import { json, problem } from "@/test/fake-api";

describe("ルーム", () => {
  it("marks a room list as not_found on 404", async () => {
    const { store } = setup({ "GET /api/v1/workspaces/ws-x/rooms": () => problem(404, "not-found") });

    await store.loadRooms("ws-x");

    expect(store.getSnapshot().roomLists["ws-x"]?.status).toBe("not_found");
  });

  it("keeps member_count from the single-room fetch when the list is reloaded", async () => {
    const { store } = setup({
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { member_count: 4 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () => json(200, { messages: [], has_more: false, last_change_seq: 0 }),
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談 改")] }),
    });

    await store.openRoom("r1");
    await store.loadRooms("ws-1");

    expect(store.getSnapshot().rooms.r1).toMatchObject({ name: "雑談 改", member_count: 4 });
  });

  it("creates a room and appends it to the workspace's list", async () => {
    const { api, store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      "POST /api/v1/workspaces/ws-1/rooms": () => json(201, room("r2", "デザイン", { kind: "private" })),
    });
    await store.loadRooms("ws-1");

    const created = await store.createRoom("ws-1", { kind: "private", name: "デザイン" });

    expect(created.id).toBe("r2");
    expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1", "r2"]);
    expect(body(api.calls.at(-1)!.init)).toEqual({ kind: "private", name: "デザイン" });
  });

  it("updates the room after joining", async () => {
    const { store } = setup({
      "POST /api/v1/rooms/r1/join": () => json(200, room("r1", "雑談", { is_member: true, last_read_seq: 0 })),
    });

    await store.joinRoom("r1");

    expect(store.getSnapshot().rooms.r1).toMatchObject({ is_member: true, last_read_seq: 0 });
  });

  it("follows the member list cursor to the end", async () => {
    const { store } = setup({
      "GET /api/v1/rooms/r1/members?limit=200": () =>
        json(200, { members: [roomMember(naoki)], next_cursor: naoki.id }),
      [`GET /api/v1/rooms/r1/members?limit=200&after=${naoki.id}`]: () =>
        json(200, { members: [roomMember(miyuki)], next_cursor: null }),
    });

    await store.loadRoomMembers("r1");

    expect(store.getSnapshot().roomMembers.r1).toEqual({ status: "ready", members: [roomMember(naoki), roomMember(miyuki)] });
  });

  describe("removal", () => {
    const privateRoomRoutes = {
      "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発"), workspace("ws-2", "個人メモ")] }),
      "GET /api/v1/workspaces/ws-1/rooms": () =>
        json(200, { rooms: [room("r1", "雑談", { kind: "private" }), room("r2", "設計", { kind: "private" })] }),
    };
    const removed = (roomId: string) => ({
      type: "room.member_removed" as const,
      data: { workspace_id: "ws-1", room_id: roomId, reason: "removed" as const },
    });

    it("drops a private room from the list at once, even the open one, and remembers it only while it stays open", async () => {
      const { store } = setup(privateRoomRoutes);
      await store.loadRooms("ws-1");
      store.setFocus({ roomId: "r1", caughtUp: true });

      store.applyEvent(removed("r1"));
      store.applyEvent(removed("r2"));

      // 名前も見せないので、開いていても一覧に残さない（ADR 0035）
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual([]);
      expect(store.getSnapshot().removedRooms).toMatchObject({ r1: "removed", r2: "removed" });

      store.setFocus(null);
      expect(store.getSnapshot().removedRooms.r1).toBeUndefined();
    });

    it("turns a public room back into a readable room I have not joined", async () => {
      const { store } = await opened();

      store.applyEvent({ type: "room.member_removed", data: { workspace_id: "ws-1", room_id: "r1", reason: "left" } });

      const state = store.getSnapshot();
      expect(state.rooms.r1).toMatchObject({ is_member: false, last_read_seq: null, unread_count: 0 });
      expect(state.roomLists["ws-1"]?.ids).toContain("r1");
      expect(state.removedRooms.r1).toBeUndefined();
      expect(state.timelines.r1?.unreadAfterSeq).toBeNull();
    });

    it("takes the workspace out of the list but remembers its name for the notice", async () => {
      const { store } = setup(privateRoomRoutes);
      await store.loadWorkspaces();

      store.applyEvent({ type: "workspace.member_removed", data: { workspace_id: "ws-1", user_id: miyuki.id, reason: "removed" } });
      expect(store.getSnapshot().workspaces.list).toHaveLength(2);

      store.applyEvent({ type: "workspace.member_removed", data: { workspace_id: "ws-1", user_id: me, reason: "removed" } });
      expect(store.getSnapshot().workspaces.list.map((w) => w.id)).toEqual(["ws-2"]);
      expect(store.getSnapshot().removedWorkspaces["ws-1"]).toMatchObject({ reason: "removed", workspace: { name: "hibari 開発" } });

      store.forgetRemovedWorkspace("ws-1");
      expect(store.getSnapshot().removedWorkspaces["ws-1"]).toBeUndefined();
    });
  });

  it("opens a dm and puts it in the list only once", async () => {
    const dm = room("r-dm", "", { kind: "dm", name: null, dm_peer: { ...miyuki, presence: "active" } });
    const { store, api } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      "POST /api/v1/workspaces/ws-1/rooms": () => json(200, dm),
    });
    await store.loadRooms("ws-1");

    await store.openDm("ws-1", miyuki.id);
    // 同じ相手をもう一度開いてもサーバーは同じルームを返す（dm_key の UNIQUE。ADR 0011）
    await store.openDm("ws-1", miyuki.id);

    expect(body(api.calls.at(-1)!.init)).toEqual({ kind: "dm", user_id: miyuki.id });
    // 並びは最後のメッセージが新しい順。まだ何も送っていない DM は後ろに入る
    expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1", "r-dm"]);
  });

  it("renames a room", async () => {
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      "PATCH /api/v1/rooms/r1": (_url, init) => json(200, room("r1", JSON.parse(init.body as string).name)),
    });
    await store.loadRooms("ws-1");

    await store.updateRoom("r1", { name: "雑談 改" });

    expect(store.getSnapshot().rooms.r1?.name).toBe("雑談 改");
  });

  it("reloads the members and the room after adding someone, and drops the row after removing", async () => {
    let members = [roomMember(naoki, { role: "admin" })];
    const { store, requests } = setup({
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "リリース準備", { kind: "private", member_count: members.length })),
      "GET /api/v1/rooms/r1/members?limit=200": () => json(200, { members, next_cursor: null }),
      "POST /api/v1/rooms/r1/members": () => new Response(null, { status: 204 }),
      [`DELETE /api/v1/rooms/r1/members/${miyuki.id}`]: () => new Response(null, { status: 204 }),
    });
    await store.loadRoomMembers("r1");
    members = [roomMember(naoki, { role: "admin" }), roomMember(miyuki)];

    await store.addRoomMember("r1", miyuki.id);
    expect(store.getSnapshot().roomMembers.r1?.members).toHaveLength(2);
    expect(requests()).toContain("POST /api/v1/rooms/r1/members");

    await store.removeRoomMember("r1", miyuki.id);
    expect(store.getSnapshot().roomMembers.r1?.members.map((m) => m.user.id)).toEqual([naoki.id]);
  });

  describe("leaveRoom", () => {
    function setupLeave(kind: "public" | "private") {
      return setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談", { kind }), room("r2", "設計")] }),
        [`DELETE /api/v1/rooms/r1/members/${naoki.id}`]: () => new Response(null, { status: 204 }),
      });
    }

    it("keeps a public room readable as a room I have not joined, without waiting for the event", async () => {
      const { store, requests } = setupLeave("public");
      await store.loadRooms("ws-1");

      await store.leaveRoom("r1");

      expect(requests()).toContain(`DELETE /api/v1/rooms/r1/members/${naoki.id}`);
      const state = store.getSnapshot();
      expect(state.rooms.r1).toMatchObject({ is_member: false, unread_count: 0 });
      expect(state.roomLists["ws-1"]?.ids).toContain("r1");
      expect(state.removedRooms.r1).toBeUndefined();
    });

    it("marks an open private room as left (not removed) so the screen goes back instead of showing a notice", async () => {
      const { store } = setupLeave("private");
      await store.loadRooms("ws-1");
      store.setFocus({ roomId: "r1", caughtUp: true });

      await store.leaveRoom("r1");
      // 同じ端末にもイベントが届く。2 回目の後始末で状態が変わらない
      store.applyEvent({ type: "room.member_removed", data: { workspace_id: "ws-1", room_id: "r1", reason: "left" } });

      expect(store.getSnapshot().removedRooms.r1).toBe("left");
      store.setFocus(null);
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r2"]);
    });

    it("leaves the room as it was when the server refuses", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談", { kind: "private" })] }),
        [`DELETE /api/v1/rooms/r1/members/${naoki.id}`]: () => problem(403, "forbidden"),
      });
      await store.loadRooms("ws-1");

      await expect(store.leaveRoom("r1")).rejects.toThrow();

      expect(store.getSnapshot().removedRooms.r1).toBeUndefined();
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1"]);
    });
  });

  describe("アーカイブと削除（ADR 0059）", () => {
    const archivedAt = "2026-09-23T01:00:00Z";

    it("アーカイブ・復元の応答でルームを置き換える", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "旧案")] }),
        "POST /api/v1/rooms/r1/archive": () => json(200, room("r1", "旧案", { archived_at: archivedAt })),
        "POST /api/v1/rooms/r1/unarchive": () => json(200, room("r1", "旧案")),
      });
      await store.loadRooms("ws-1");

      await store.archiveRoom("r1");
      expect(store.getSnapshot().rooms.r1?.archived_at).toBe(archivedAt);
      // 一覧からは外さない（サイドバーの検索で探せるように。出し分けは Sidebar）
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1"]);

      await store.unarchiveRoom("r1");
      expect(store.getSnapshot().rooms.r1?.archived_at).toBeNull();
    });

    it("ほかの端末のアーカイブは room.updated の archived_at で届く", async () => {
      const { store } = setup({ "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "旧案")] }) });
      await store.loadRooms("ws-1");

      store.applyEvent({
        type: "room.updated",
        data: { workspace_id: "ws-1", room_id: "r1", name: "旧案", is_default: false, archived_at: archivedAt },
      });
      expect(store.getSnapshot().rooms.r1?.archived_at).toBe(archivedAt);
    });

    it("room.deleted で、公開ルームでも一覧と中身を捨て、開いている画面は「アクセスできません」にする", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "旧案"), room("r2", "設計")] }),
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "旧案")),
        "GET /api/v1/rooms/r1/messages?limit=50": () => json(200, { messages: [message(1, { room_id: "r1" })], has_more: false, last_change_seq: 1 }),
      });
      await store.loadRooms("ws-1");
      await store.openRoom("r1");

      store.applyEvent({ type: "room.deleted", data: { workspace_id: "ws-1", room_id: "r1" } });

      const state = store.getSnapshot();
      expect(state.roomLists["ws-1"]?.ids).toEqual(["r2"]);
      expect(state.timelines.r1).toBeUndefined();
      expect(state.removedRooms.r1).toBe("removed");
    });

    it("自分で削除したら left にして、あとから自分宛ての room.deleted が届いても変えない", async () => {
      const { store, requests } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "旧案"), room("r2", "設計")] }),
        "DELETE /api/v1/rooms/r1": () => new Response(null, { status: 204 }),
      });
      await store.loadRooms("ws-1");

      await store.deleteRoom("r1");
      store.applyEvent({ type: "room.deleted", data: { workspace_id: "ws-1", room_id: "r1" } });

      expect(requests()).toContain("DELETE /api/v1/rooms/r1");
      expect(store.getSnapshot().removedRooms.r1).toBe("left");
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r2"]);
    });

    it("削除を断られたら、何も変えない", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "旧案")] }),
        "DELETE /api/v1/rooms/r1": () => problem(403, "forbidden"),
      });
      await store.loadRooms("ws-1");

      await expect(store.deleteRoom("r1")).rejects.toThrow();
      expect(store.getSnapshot().removedRooms.r1).toBeUndefined();
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1"]);
    });
  });
});
