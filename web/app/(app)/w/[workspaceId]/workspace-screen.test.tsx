import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Room } from "@/lib/api/types.gen";
import { lastRoomId, lastWorkspaceId, rememberLocation } from "@/lib/chat/last-location";
import { message, miyuki, naoki, room, roomMember, workspace } from "@/test/chat-data";
import { type Handler, json, problem } from "@/test/fake-api";
import { renderWithChat } from "@/test/render-with-chat";

import { WorkspaceScreen } from "./workspace-screen";

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  params: {} as { workspaceId: string; roomId?: string },
}));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, useParams: () => nav.params }));

const design = room("r-design", "デザインレビュー", {
  last_message_seq: 3,
  last_read_seq: 1,
  unread_count: 2,
  last_message_at: "2026-09-13T02:05:00Z",
  last_message: { id: "m-3", sender: miyuki, body: "presence を確認します", created_at: "2026-09-13T02:05:00Z", deleted: false },
});
const chat = room("r-chat", "雑談", { is_default: true });
const dm = room("r-dm", "", { kind: "dm", name: null, dm_peer: { ...naoki, online: true } });

function routes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/v1/workspaces": () =>
      json(200, { workspaces: [workspace("ws-1", "hibari 開発"), workspace("ws-2", "個人メモ")] }),
    "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [design, chat, dm] }),
    ...overrides,
  };
}

function openRoom(r: Room, messages = [message(1), message(2), message(3)]): Record<string, Handler> {
  return {
    [`GET /api/v1/rooms/${r.id}`]: () => json(200, { ...r, member_count: 4 }),
    [`GET /api/v1/rooms/${r.id}/messages?limit=50`]: () =>
      json(200, { messages: messages.map((m) => ({ ...m, room_id: r.id })), has_more: false, last_change_seq: 3 }),
    [`POST /api/v1/rooms/${r.id}/read`]: () => json(200, { last_read_seq: r.last_message_seq, unread_count: 0 }),
  };
}

function sidebar() {
  return within(screen.getByRole("navigation", { name: "チャンネル" }));
}

describe("WorkspaceScreen", () => {
  beforeEach(() => {
    nav.router.replace.mockReset();
    nav.router.push.mockReset();
    nav.params = { workspaceId: "ws-1" };
    window.localStorage.clear();
  });

  describe("choosing a room", () => {
    it("opens the last room opened in this workspace", async () => {
      rememberLocation("ws-1", "r-dm");

      renderWithChat(<WorkspaceScreen />, routes());

      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1/r/r-dm"));
    });

    it("falls back to the default room, then to the first room", async () => {
      rememberLocation("ws-1", "r-deleted");

      const first = renderWithChat(<WorkspaceScreen />, routes());
      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1/r/r-chat"));
      first.unmount();

      nav.router.replace.mockReset();
      renderWithChat(
        <WorkspaceScreen />,
        routes({ "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [design, dm] }) }),
      );
      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1/r/r-design"));
    });

    it("leaves a workspace the user is not a member of and forgets it", async () => {
      rememberLocation("ws-9", "r-x");
      nav.params = { workspaceId: "ws-9" };

      renderWithChat(
        <WorkspaceScreen />,
        routes({ "GET /api/v1/workspaces/ws-9/rooms": () => problem(404, "not-found") }),
      );

      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/"));
      expect(lastWorkspaceId()).toBeUndefined();
    });
  });

  describe("an open room", () => {
    beforeEach(() => {
      nav.params = { workspaceId: "ws-1", roomId: "r-design" };
    });

    it("shows the rooms, the history with the unread divider, and marks it read", async () => {
      const { api } = renderWithChat(<WorkspaceScreen />, routes(openRoom(design)));

      expect(await screen.findByRole("heading", { name: /デザインレビュー/ })).toBeInTheDocument();
      expect(screen.getByText("メンバー4人")).toBeInTheDocument();
      expect(sidebar().getByRole("link", { name: /デザインレビュー/ })).toHaveAttribute("aria-current", "page");
      expect(sidebar().getByRole("link", { name: /佐藤 直樹/ })).toHaveAttribute("href", "/w/ws-1/r/r-dm");

      const history = within(screen.getByRole("list", { name: "メッセージ" }));
      expect(history.getAllByRole("article").map((a) => a.textContent)).toEqual([
        expect.stringContaining("本文 1"),
        expect.stringContaining("本文 2"),
        expect.stringContaining("本文 3"),
      ]);
      expect(history.getByText("ここから未読")).toBeInTheDocument();

      await waitFor(() => expect(api.paths()).toContain("POST /api/v1/rooms/r-design/read"));
      // 未読数はサイドバーから消えるが、開いている間は区切りを残す
      await waitFor(() =>
        expect(within(sidebar().getByRole("link", { name: /デザインレビュー/ })).queryByText("2")).not.toBeInTheDocument(),
      );
      expect(history.getByText("ここから未読")).toBeInTheDocument();
      expect(lastRoomId("ws-1")).toBe("r-design");

      await userEvent.click(history.getByRole("button", { name: "すべて既読にする" }));
      expect(history.queryByText("ここから未読")).not.toBeInTheDocument();
    });

    it("does not show a composer yet", async () => {
      renderWithChat(<WorkspaceScreen />, routes(openRoom(design)));

      await screen.findByRole("list", { name: "メッセージ" });
      expect(screen.queryByRole("textbox", { name: /メッセージ/ })).not.toBeInTheDocument();
    });

    it("shows the start of an empty room", async () => {
      nav.params = { workspaceId: "ws-1", roomId: "r-chat" };

      renderWithChat(<WorkspaceScreen />, routes(openRoom(chat, [])));

      expect(await screen.findByText("# 雑談 のはじまりです")).toBeInTheDocument();
    });

    it("lets a non-member read a public room and join it", async () => {
      const guest = { ...design, is_member: false, last_read_seq: null, unread_count: 0 };
      const { api } = renderWithChat(
        <WorkspaceScreen />,
        routes({
          "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [guest, chat] }),
          ...openRoom(guest),
          "POST /api/v1/rooms/r-design/join": () => json(200, { ...design, is_member: true, last_read_seq: 0 }),
        }),
      );

      await screen.findByRole("list", { name: "メッセージ" });
      expect(api.paths()).not.toContain("POST /api/v1/rooms/r-design/read");
      await userEvent.click(screen.getByRole("button", { name: "参加する" }));

      await waitFor(() => expect(screen.queryByRole("button", { name: "参加する" })).not.toBeInTheDocument());
    });

    it("goes back to the workspace when the room cannot be read", async () => {
      rememberLocation("ws-1", "r-design");

      renderWithChat(
        <WorkspaceScreen />,
        routes({
          "GET /api/v1/rooms/r-design": () => problem(404, "not-found"),
          "GET /api/v1/rooms/r-design/messages?limit=50": () => problem(404, "not-found"),
        }),
      );

      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1"));
      expect(lastRoomId("ws-1")).toBeUndefined();
    });

    it("opens the members panel", async () => {
      renderWithChat(
        <WorkspaceScreen />,
        routes({
          ...openRoom(design),
          "GET /api/v1/rooms/r-design/members?limit=200": () =>
            json(200, {
              members: [roomMember(naoki, { role: "owner", online: true }), roomMember(miyuki)],
              next_cursor: null,
            }),
        }),
      );

      await userEvent.click(await screen.findByRole("button", { name: "メンバー" }));

      const panel = within(await screen.findByRole("complementary", { name: "メンバー" }));
      expect(await panel.findByText("佐藤 直樹")).toBeInTheDocument();
      expect(panel.getByText("オーナー")).toBeInTheDocument();
      await userEvent.click(panel.getByRole("button", { name: "閉じる" }));
      expect(screen.queryByRole("complementary", { name: "メンバー" })).not.toBeInTheDocument();
    });

    it("filters the rooms by name", async () => {
      renderWithChat(<WorkspaceScreen />, routes(openRoom(design)));

      await userEvent.type(await screen.findByRole("searchbox", { name: "チャンネルを検索" }), "雑");

      expect(sidebar().getAllByRole("link").map((l) => l.textContent)).toEqual([expect.stringContaining("雑談")]);
    });

    it("switches to another workspace", async () => {
      renderWithChat(<WorkspaceScreen />, routes(openRoom(design)));

      await userEvent.click(await screen.findByRole("button", { name: /hibari 開発/ }));
      await userEvent.click(screen.getByRole("button", { name: /個人メモ/ }));

      expect(nav.router.push).toHaveBeenCalledWith("/w/ws-2");
      expect(screen.queryByRole("dialog", { name: "ワークスペースを切り替える" })).not.toBeInTheDocument();
    });
  });

  it("creates the first channel of an empty workspace and opens it", async () => {
    const { api } = renderWithChat(
      <WorkspaceScreen />,
      routes({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [] }),
        "POST /api/v1/workspaces/ws-1/rooms": () => json(201, room("r-new", "リリース準備", { kind: "private" })),
      }),
    );

    await userEvent.click(await screen.findByRole("button", { name: "チャンネルを作成" }));
    await userEvent.type(screen.getByLabelText("チャンネル名"), "リリース準備");
    await userEvent.click(screen.getByRole("radio", { name: /非公開/ }));
    await userEvent.click(screen.getByRole("button", { name: "作成する" }));

    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith("/w/ws-1/r/r-new"));
    expect(JSON.parse(api.calls.at(-1)!.init.body as string)).toEqual({ kind: "private", name: "リリース準備" });
    expect(sidebar().getByRole("link", { name: /リリース準備/ })).toBeInTheDocument();
  });

  describe("realtime", () => {
    beforeEach(() => {
      nav.params = { workspaceId: "ws-1", roomId: "r-design" };
    });

    /** 開いた後の差分の取得は、何も変わっていない応答にする。 */
    function live(overrides: Record<string, Handler> = {}) {
      return routes({
        ...openRoom(design),
        "GET /api/v1/rooms/r-design/messages?after_change_seq=3&limit=100": () =>
          json(200, { messages: [], has_more: false, last_change_seq: 3 }),
        ...overrides,
      });
    }

    async function connected(overrides: Record<string, Handler> = {}) {
      const result = renderWithChat(<WorkspaceScreen />, live(overrides));
      await screen.findByRole("list", { name: "メッセージ" });
      await waitFor(() => expect(result.sockets.sockets).toHaveLength(1));
      result.sockets.last().open();
      // 表示中のワークスペースとサイドバーのルームを購読する
      await waitFor(() =>
        expect(result.sockets.last().messages()).toEqual(
          expect.arrayContaining([
            { type: "subscribe", workspace_id: "ws-1" },
            { type: "subscribe", room_id: "r-design" },
            { type: "subscribe", room_id: "r-chat" },
            { type: "subscribe", room_id: "r-dm" },
          ]),
        ),
      );
      return result;
    }

    it("shows a message from someone else as it arrives and reads it while the latest is in view", async () => {
      const { sockets, api } = await connected({
        "POST /api/v1/rooms/r-design/read": (_url, init) =>
          json(200, { last_read_seq: JSON.parse(init.body as string).seq, unread_count: 0 }),
      });

      sockets.last().receive({
        type: "message.created",
        data: message(4, { room_id: "r-design", change_seq: 4, body: "リアルタイムで届いた" }),
      });

      expect(await screen.findByText("リアルタイムで届いた")).toBeInTheDocument();
      await waitFor(() =>
        expect(api.calls.filter((c) => c.path === "/api/v1/rooms/r-design/read").map((c) => JSON.parse(c.init.body as string))).toContainEqual({ seq: 4 }),
      );
    });

    it("shows who is typing", async () => {
      const { sockets } = await connected();

      sockets.last().receive({ type: "typing.started", data: { workspace_id: "ws-1", room_id: "r-design", user: miyuki } });

      expect(await screen.findByText("高橋 みゆき が入力中")).toBeInTheDocument();
    });

    it("shows the reconnecting banner, then syncs and shows that it is restored", async () => {
      const { sockets } = await connected();

      sockets.last().serverClose(1001);
      expect(await screen.findByText("接続が切れました。再接続しています…")).toBeInTheDocument();

      await waitFor(() => expect(sockets.sockets).toHaveLength(2));
      sockets.last().open();

      expect(await screen.findByText("接続が復帰しました")).toBeInTheDocument();
    });

    it("replaces the history with a notice when removed from a private channel", async () => {
      const secret = { ...design, kind: "private" as const };
      rememberLocation("ws-1", "r-design");
      const { sockets } = await connected({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [secret, chat, dm] }),
        ...openRoom(secret),
      });

      sockets.last().receive({
        type: "room.member_removed",
        data: { workspace_id: "ws-1", room_id: "r-design", reason: "removed" },
      });

      const notice = await screen.findByRole("heading", { name: "このチャンネルから外されました" });
      expect(screen.queryByRole("list", { name: "メッセージ" })).not.toBeInTheDocument();
      // 開いている間は、サイドバーにもヘッダーにも残す（chat/removed-from-channel.png）
      expect(screen.getByRole("heading", { name: /デザインレビュー/ })).toBeInTheDocument();
      expect(sidebar().getByRole("link", { name: /デザインレビュー/ })).toBeInTheDocument();

      // ヘッダーのモバイル用の「戻る」と同じ名前なので、お知らせの中のボタンを押す
      await userEvent.click(within(notice.parentElement!).getByRole("button", { name: "チャンネル一覧に戻る" }));
      expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1");
      expect(lastRoomId("ws-1")).toBeUndefined();
    });

    it("keeps a public channel readable after leaving it elsewhere", async () => {
      const { sockets } = await connected();

      sockets.last().receive({
        type: "room.member_removed",
        data: { workspace_id: "ws-1", room_id: "r-design", reason: "left" },
      });

      expect(await screen.findByRole("button", { name: "参加する" })).toBeInTheDocument();
      expect(screen.getByRole("list", { name: "メッセージ" })).toBeInTheDocument();
    });

    it("shows a notice when kicked from the workspace and moves on", async () => {
      rememberLocation("ws-1", "r-design");
      const { sockets } = await connected();

      sockets.last().receive({
        type: "workspace.member_removed",
        data: { workspace_id: "ws-1", user_id: naoki.id, reason: "removed" },
      });

      expect(await screen.findByRole("heading", { name: "ワークスペースから削除されました" })).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "メッセージ" })).not.toBeInTheDocument();
      expect(nav.router.replace).not.toHaveBeenCalledWith("/");

      await userEvent.click(screen.getByRole("button", { name: "別のワークスペースに移動" }));
      expect(nav.router.replace).toHaveBeenCalledWith("/");
      expect(lastWorkspaceId()).toBeUndefined();
    });
  });
});
