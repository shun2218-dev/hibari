import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Room } from "@/lib/api/types.gen";
import { lastRoomId, lastWorkspaceId, rememberLocation } from "@/lib/chat/last-location";
import { kei, member, message, miyuki, naoki, room, roomMember, workspace } from "@/test/chat-data";
import { type Handler, json, problem, testUser } from "@/test/fake-api";
import { renderWithChat } from "@/test/render-with-chat";

import { WorkspaceScreen } from "./workspace-screen";

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  params: {} as { workspaceId: string; roomId?: string },
  // 開いているスレッド（?thread=）と、パス（/w/{id}/threads の判定）
  search: "",
  pathname: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useParams: () => nav.params,
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => nav.pathname,
}));

const design = room("r-design", "デザインレビュー", {
  last_message_seq: 3,
  last_read_seq: 1,
  unread_count: 2,
  last_message_at: "2026-09-13T02:05:00Z",
  last_user_seq: 3,
  last_read_user_seq: 1,
  last_message: { id: "m-3", sender: miyuki, kind: "user", body: "presence を確認します", created_at: "2026-09-13T02:05:00Z", deleted: false },
});
const chat = room("r-chat", "雑談", { is_default: true });
const dm = room("r-dm", "", { kind: "dm", name: null, dm_peer: { ...naoki, online: true } });

function routes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/v1/workspaces": () =>
      json(200, { workspaces: [workspace("ws-1", "hibari 開発"), workspace("ws-2", "個人メモ")] }),
    "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [design, chat, dm], unread_thread_count: 0 }),
    "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [], next_cursor: null }),
    ...overrides,
  };
}

function openRoom(r: Room, messages = [message(1), message(2), message(3)]): Record<string, Handler> {
  return {
    [`GET /api/v1/rooms/${r.id}`]: () => json(200, { ...r, member_count: 4 }),
    [`GET /api/v1/rooms/${r.id}/messages?limit=50`]: () =>
      json(200, { messages: messages.map((m) => ({ ...m, room_id: r.id })), has_more: false, last_change_seq: 3 }),
    [`POST /api/v1/rooms/${r.id}/read`]: () => json(200, { last_read_seq: r.last_message_seq, last_read_user_seq: r.last_message_seq, unread_count: 0, mention_count: 0 }),
    // `@` の補完のために、ルームを開いた時点でメンバーを引く（ADR 0043）
    [`GET /api/v1/rooms/${r.id}/members?limit=200`]: () =>
      json(200, { members: [roomMember(naoki, { role: "owner", online: true }), roomMember(miyuki), roomMember(kei)], next_cursor: null }),
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
    nav.search = "";
    nav.pathname = "/w/ws-1";
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

    it("shows the same no-access notice as a removal when the room in the url cannot be read", async () => {
      rememberLocation("ws-1", "r-design");

      renderWithChat(
        <WorkspaceScreen />,
        routes({
          "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [chat, dm] }),
          "GET /api/v1/rooms/r-design": () => problem(404, "not-found"),
          "GET /api/v1/rooms/r-design/messages?limit=50": () => problem(404, "not-found"),
        }),
      );

      // 存在しないのか読めないのかは区別しない（ADR 0035）。入口から開き直したときに、また開かないように忘れる
      expect(await screen.findByRole("heading", { name: "このチャンネルにはアクセスできません" })).toBeInTheDocument();
      expect(lastRoomId("ws-1")).toBeUndefined();
      expect(nav.router.replace).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "チャンネル一覧に戻る" }));
      expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1");
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

    it("opens a dm with a member picked from the sidebar", async () => {
      const user = userEvent.setup();
      const dmRoom = room("r-new-dm", "", { kind: "dm", name: null, dm_peer: { ...miyuki, online: true } });
      const { api } = renderWithChat(
        <WorkspaceScreen />,
        routes({
          ...openRoom(design),
          "GET /api/v1/workspaces/ws-1/members?limit=200": () =>
            json(200, { members: [member(naoki, { role: "owner" }), member(miyuki)], next_cursor: null }),
          "POST /api/v1/workspaces/ws-1/rooms": () => json(201, dmRoom),
        }),
      );

      await user.click(await screen.findByRole("button", { name: "ダイレクトメッセージを開く" }));
      // 自分（佐藤 直樹）は候補に出ない
      expect(await screen.findByRole("radio", { name: /高橋 みゆき/ })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: /佐藤 直樹/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole("radio", { name: /高橋 みゆき/ }));
      await user.click(screen.getByRole("button", { name: "開く" }));

      await waitFor(() => expect(api.calls.at(-1)?.init.body).toBe(JSON.stringify({ kind: "dm", user_id: miyuki.id })));
      await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith("/w/ws-1/r/r-new-dm"));
    });

    it("renames a channel and manages its members from the header", async () => {
      const user = userEvent.setup();
      const priv = room("r-priv", "リリース準備", { kind: "private", member_count: 2 });
      nav.params = { workspaceId: "ws-1", roomId: "r-priv" };
      const { api } = renderWithChat(
        <WorkspaceScreen />,
        routes({
          "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発", { my_role: "admin" })] }),
          "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [priv] }),
          ...openRoom(priv, []),
          "GET /api/v1/rooms/r-priv/members?limit=200": () =>
            json(200, { members: [roomMember(naoki, { role: "admin" }), roomMember(miyuki)], next_cursor: null }),
          "GET /api/v1/workspaces/ws-1/members?limit=200": () =>
            json(200, {
              members: [member(naoki, { role: "admin" }), member(miyuki), member(kei)],
              next_cursor: null,
            }),
          "PATCH /api/v1/rooms/r-priv": (_url, init) => json(200, { ...priv, ...JSON.parse(init.body as string) }),
          "POST /api/v1/rooms/r-priv/members": () => new Response(null, { status: 204 }),
          [`DELETE /api/v1/rooms/r-priv/members/${miyuki.id}`]: () => new Response(null, { status: 204 }),
        }),
      );

      await user.click(await screen.findByRole("button", { name: "チャンネルの設定" }));
      const dialog = within(await screen.findByRole("dialog"));

      // 参加していない人だけを候補に出す
      await user.click(await dialog.findByRole("button", { name: "メンバーを追加" }));
      const picker = within(await screen.findByRole("dialog"));
      expect(await picker.findByRole("radio", { name: /森田 圭/ })).toBeInTheDocument();
      expect(picker.queryByRole("radio", { name: /高橋 みゆき/ })).not.toBeInTheDocument();
      await user.click(picker.getByRole("radio", { name: /森田 圭/ }));
      await user.click(picker.getByRole("button", { name: "追加する" }));
      await waitFor(() => expect(api.paths()).toContain("POST /api/v1/rooms/r-priv/members"));

      // 外す
      await user.click(within(await screen.findByRole("dialog")).getAllByRole("button", { name: "外す" })[0]);
      await waitFor(() => expect(api.paths()).toContain(`DELETE /api/v1/rooms/r-priv/members/${miyuki.id}`));

      // 名前を変える
      const field = within(screen.getByRole("dialog")).getByLabelText("チャンネル名");
      await user.clear(field);
      await user.type(field, "リリース準備 2");
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "保存する" }));

      await waitFor(() => expect(api.calls.at(-1)?.init.body).toBe(JSON.stringify({ name: "リリース準備 2" })));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("leaves a private channel from its settings and goes back to the workspace without a notice", async () => {
      const user = userEvent.setup();
      const priv = room("r-priv", "リリース準備", { kind: "private", member_count: 2 });
      nav.params = { workspaceId: "ws-1", roomId: "r-priv" };
      rememberLocation("ws-1", "r-priv");
      const { api } = renderWithChat(
        <WorkspaceScreen />,
        routes({
          "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [priv, chat] }),
          ...openRoom(priv, []),
          "GET /api/v1/rooms/r-priv/members?limit=200": () => json(200, { members: [roomMember(naoki)], next_cursor: null }),
          "GET /api/v1/workspaces/ws-1/members?limit=200": () => json(200, { members: [member(naoki)], next_cursor: null }),
          [`DELETE /api/v1/rooms/r-priv/members/${testUser.id}`]: () => new Response(null, { status: 204 }),
        }),
      );

      // member でも（読み取り専用の設定から）退出できる
      await user.click(await screen.findByRole("button", { name: "チャンネルの設定" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "退出する" }));
      const confirm = within(await screen.findByRole("dialog"));
      expect(confirm.getByText(/リリース準備 から退出します。.*読めなくなります/)).toBeInTheDocument();
      await user.click(confirm.getByRole("button", { name: "退出する" }));

      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1"));
      expect(api.paths()).toContain(`DELETE /api/v1/rooms/r-priv/members/${testUser.id}`);
      expect(screen.queryByText(/外されました/)).not.toBeInTheDocument();
      expect(lastRoomId("ws-1")).toBeUndefined();
    });

    it("keeps a public channel readable after leaving it, and backs out of the confirmation to the settings", async () => {
      const user = userEvent.setup();
      renderWithChat(
        <WorkspaceScreen />,
        routes({
          ...openRoom(design),
          [`DELETE /api/v1/rooms/r-design/members/${testUser.id}`]: () => new Response(null, { status: 204 }),
        }),
      );

      await user.click(await screen.findByRole("button", { name: "チャンネルの設定" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "退出する" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "キャンセル" }));
      expect(await screen.findByRole("heading", { name: "チャンネルの設定" })).toBeInTheDocument();

      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "退出する" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "退出する" }));

      expect(await screen.findByRole("button", { name: "参加する" })).toBeInTheDocument();
      expect(screen.getByRole("list", { name: "メッセージ" })).toBeInTheDocument();
      expect(nav.router.replace).not.toHaveBeenCalled();

      // 参加していないので、設定からはもう退出を出さない
      await user.click(screen.getByRole("button", { name: "チャンネルの設定" }));
      expect(within(await screen.findByRole("dialog")).queryByRole("button", { name: "退出する" })).not.toBeInTheDocument();
    });

    it("does not offer channel settings for a dm", async () => {
      nav.params = { workspaceId: "ws-1", roomId: "r-dm" };
      renderWithChat(<WorkspaceScreen />, routes(openRoom(dm)));

      expect(await screen.findByRole("button", { name: "メンバー" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "チャンネルの設定" })).not.toBeInTheDocument();
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
          json(200, { last_read_seq: JSON.parse(init.body as string).seq, last_read_user_seq: JSON.parse(init.body as string).seq, unread_count: 0 }),
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

    describe("writing", () => {
      const history = () => within(screen.getByRole("list", { name: "メッセージ" }));
      const composer = () => screen.getByRole("textbox", { name: "メッセージ" });

      /** 送信の API。client_msg_id ごとに 1 回だけ採番し、同じ値の再送には同じメッセージを返す。 */
      function sendRoute({ reachable = (): boolean => true } = {}) {
        const sent: { client_msg_id: string; body: string; reply_to_id?: string }[] = [];
        const created = new Map<string, ReturnType<typeof message>>();
        const handler: Handler = (_url, init) => {
          const req = JSON.parse(init.body as string);
          sent.push(req);
          if (!reachable()) throw new TypeError("Failed to fetch");
          const existing = created.get(req.client_msg_id);
          if (existing) return json(200, existing);
          const seq = 4 + created.size;
          const m = message(seq, { room_id: "r-design", change_seq: seq, sender: naoki, client_msg_id: req.client_msg_id, body: req.body });
          created.set(req.client_msg_id, m);
          return json(201, m);
        };
        return { sent, handler };
      }

      it("shows the message while sending, clears the input, and tells others I am typing", async () => {
        let respond!: () => void;
        const responded = new Promise<void>((r) => (respond = r));
        const route = sendRoute();
        const { sockets } = await connected({
          "POST /api/v1/rooms/r-design/messages": async (url, init) => {
            await responded;
            return route.handler(url, init);
          },
        });

        await userEvent.type(composer(), "こんにちは");
        expect(sockets.last().messages()).toContainEqual({ type: "typing", room_id: "r-design" });
        await userEvent.keyboard("{Enter}");

        expect(composer()).toHaveValue("");
        const pending = history().getByRole("article", { name: /佐藤 直樹/ });
        expect(within(pending).getByText("こんにちは")).toBeInTheDocument();
        expect(within(pending).getByRole("img", { name: "送信中" })).toBeInTheDocument();

        respond();
        await waitFor(() => expect(history().queryByRole("img", { name: "送信中" })).not.toBeInTheDocument());
        expect(history().getAllByText("こんにちは")).toHaveLength(1);
        expect(route.sent).toEqual([{ client_msg_id: expect.stringMatching(/^[0-9A-Z]{26}$/), body: "こんにちは" }]);
      });

      it("marks a message sent while offline as failed, and resending it does not post twice", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        let online = false;
        const route = sendRoute({ reachable: () => online });
        const { sockets } = await connected({ "POST /api/v1/rooms/r-design/messages": route.handler });

        await userEvent.type(composer(), "切断中に送信{Enter}");
        expect(await history().findByText("送信できませんでした")).toBeInTheDocument();

        online = true;
        await userEvent.click(history().getByRole("button", { name: "再送する" }));
        await waitFor(() => expect(history().queryByText("送信できませんでした")).not.toBeInTheDocument());
        // 同じメッセージの created イベントが後から届いても、1 件のまま
        sockets.last().receive({
          type: "message.created",
          data: message(4, { room_id: "r-design", change_seq: 4, sender: naoki, client_msg_id: route.sent[0]!.client_msg_id, body: "切断中に送信" }),
        });

        expect(route.sent.map((r) => r.client_msg_id)).toEqual([route.sent[0]!.client_msg_id, route.sent[0]!.client_msg_id]);
        await waitFor(() => expect(history().getAllByText("切断中に送信")).toHaveLength(1));
      });

      it("discards a failed message", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        await connected({ "POST /api/v1/rooms/r-design/messages": sendRoute({ reachable: () => false }).handler });

        await userEvent.type(composer(), "やめる{Enter}");
        await userEvent.click(await history().findByRole("button", { name: "削除" }));

        expect(history().queryByText("やめる")).not.toBeInTheDocument();
      });

      it("keeps thread replies out of the channel (ADR 0036)", async () => {
        await connected(openRoom(design, [message(1), message(2), message(3, { thread_root_id: "m-1", thread_seq: 1, body: "スレッドの返信" })]));

        expect(history().getAllByRole("article")).toHaveLength(2);
        expect(history().queryByText("スレッドの返信")).not.toBeInTheDocument();
      });

      describe("mentions (ADR 0041 / 0043)", () => {
        it("completes a handle and sends the id, not the handle", async () => {
          const route = sendRoute();
          await connected({ "POST /api/v1/rooms/r-design/messages": route.handler });

          await userEvent.type(composer(), "@miy");
          const list = within(await screen.findByRole("list", { name: "メンションの候補" }));
          await userEvent.click(list.getByRole("button", { name: /高橋 みゆき/ }));
          expect(composer()).toHaveValue("@miyuki ");

          await userEvent.type(composer(), "おはよう{Enter}");
          await waitFor(() => expect(route.sent).toHaveLength(1));
          expect(route.sent[0]!.body).toBe(`<@${miyuki.id}> おはよう`);
        });

        it("leaves an unknown handle as plain text", async () => {
          const route = sendRoute();
          await connected({ "POST /api/v1/rooms/r-design/messages": route.handler });

          await userEvent.type(composer(), "@dareka よろしく{Enter}");
          await waitFor(() => expect(route.sent).toHaveLength(1));
          expect(route.sent[0]!.body).toBe("@dareka よろしく");
        });

        it("asks before sending @channel and counts the recipients without me", async () => {
          const route = sendRoute();
          await connected({ "POST /api/v1/rooms/r-design/messages": route.handler });

          await userEvent.type(composer(), "@channel 明日は休みます{Enter}");
          const dialog = within(await screen.findByRole("dialog", { name: "@channel を送りますか？" }));
          expect(screen.getByText("このチャンネルのメンバー 2 人に知らせが飛びます。")).toBeInTheDocument();

          await userEvent.click(dialog.getByRole("button", { name: "キャンセル" }));
          expect(route.sent).toHaveLength(0);
          expect(composer()).toHaveValue("@channel 明日は休みます");

          await userEvent.keyboard("{Enter}");
          await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "送信する" }));
          await waitFor(() => expect(route.sent).toHaveLength(1));
          expect(route.sent[0]!.body).toBe("<!channel> 明日は休みます");
          expect(composer()).toHaveValue("");
        });

        it("does not ask for a mention to one person", async () => {
          const route = sendRoute();
          await connected({ "POST /api/v1/rooms/r-design/messages": route.handler });

          await userEvent.type(composer(), "@miyuki ありがとう{Enter}");
          await waitFor(() => expect(route.sent).toHaveLength(1));
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        });

        it("shows the name instead of the id, and marks the row addressed to me", async () => {
          const { sockets } = await connected();

          sockets.last().receive({
            type: "message.created",
            data: message(4, {
              room_id: "r-design",
              change_seq: 4,
              sender: miyuki,
              body: `<@${naoki.id}> 確認おねがいします`,
              mentions: [{ kind: "user", user: naoki }],
            }),
          });

          const row = await history().findByRole("article", { name: /あなた宛て/ });
          expect(within(row).getByRole("button", { name: "@佐藤 直樹" })).toBeInTheDocument();
          expect(within(row).queryByText(new RegExp(naoki.id))).not.toBeInTheDocument();
        });

        it("counts a mention in another room in the sidebar", async () => {
          const { sockets } = await connected();

          sockets.last().receive({
            type: "message.created",
            data: message(4, {
              room_id: "r-chat",
              change_seq: 4,
              sender: miyuki,
              body: "<!here> 手が空いている人いますか",
              mentions: [{ kind: "here", user: naoki }],
            }),
          });

          const row = await sidebar().findByRole("link", { name: /雑談/ });
          expect(within(row).getByLabelText("メンション 1 件")).toHaveTextContent("@1");
        });

        it("edits with handles and saves ids", async () => {
          const body = `<@${miyuki.id}> よろしく`;
          const mine = message(3, { sender: naoki, body, mentions: [{ kind: "user", user: miyuki }] });
          const sent: string[] = [];
          await connected({
            ...openRoom(design, [message(1), message(2), mine]),
            "PATCH /api/v1/rooms/r-design/messages/m-3": (_url, init) => {
              const edited = JSON.parse(init.body as string).body;
              sent.push(edited);
              return json(200, { ...mine, room_id: "r-design", change_seq: 4, body: edited, edited_at: "2026-09-13T02:00:00Z" });
            },
          });

          const article = history().getAllByRole("article")[2]!;
          await userEvent.click(within(article).getByRole("button", { name: "その他の操作" }));
          await userEvent.click(screen.getByRole("button", { name: "メッセージを編集" }));

          // 編集のときは ID ではなくハンドルで見せる（ADR 0043）
          const editor = screen.getByRole("textbox", { name: "メッセージを編集" });
          expect(editor).toHaveValue("@miyuki よろしく");
          await userEvent.clear(editor);
          await userEvent.type(editor, "@miyuki ありがとう{Enter}");

          await waitFor(() => expect(sent).toEqual([`<@${miyuki.id}> ありがとう`]));
        });
      });

      describe("threads (ADR 0036 / 0037)", () => {
        const root = message(2, {
          room_id: "r-design",
          body: "親のメッセージ",
          thread: { reply_count: 2, last_thread_seq: 2, last_reply_at: "2026-09-13T01:30:00Z" },
        });
        const replies = [
          message(4, { room_id: "r-design", change_seq: 4, body: "返信 1", thread_root_id: "m-2", thread_seq: 1 }),
          message(5, { room_id: "r-design", change_seq: 5, body: "返信 2", thread_root_id: "m-2", thread_seq: 2 }),
        ];
        const panel = () => within(screen.getByRole("complementary", { name: "スレッド" }));
        function threadRoute(lastRead: number | null = 0): Record<string, Handler> {
          return {
            "GET /api/v1/rooms/r-design/threads/m-2/messages?limit=50": () =>
              json(200, { root, messages: replies, has_more: false, last_change_seq: 5, last_read_thread_seq: lastRead }),
            "POST /api/v1/rooms/r-design/threads/m-2/read": () =>
              json(200, { following: lastRead !== null, last_read_thread_seq: 2, unread_count: 0 }),
          };
        }
        const followed = (unread: number) => ({
          room: { id: "r-design", kind: "public", name: "デザインレビュー" },
          root: { id: "m-2", sender: miyuki, kind: "user", body: "親のメッセージ", created_at: "2026-09-13T01:00:00Z", deleted: false },
          root_seq: 2,
          reply_count: 2,
          last_reply_at: "2026-09-13T01:30:00Z",
          last_thread_seq: 2,
          last_read_thread_seq: 2 - unread,
          unread_count: unread,
        });

        it("opens the thread from the reply action and from the reply count", async () => {
          await connected(openRoom(design, [message(1), root, message(3)]));

          const article = history().getAllByRole("article")[1]!;
          expect(within(article).getByRole("button", { name: /2 件の返信/ })).toBeInTheDocument();
          await userEvent.click(within(article).getByRole("button", { name: /2 件の返信/ }));
          expect(nav.router.push).toHaveBeenLastCalledWith("/w/ws-1/r/r-design?thread=m-2");

          await userEvent.click(within(article).getByRole("button", { name: "返信", hidden: true }));
          expect(nav.router.push).toHaveBeenCalledTimes(2);
        });

        it("shows the root and the replies in the panel, and reads them while open", async () => {
          nav.search = "thread=m-2";
          const { api } = await connected({
            ...openRoom(design, [message(1), root, message(3)]),
            ...threadRoute(0),
            "POST /api/v1/rooms/r-design/threads/m-2/read": () =>
              json(200, { following: true, last_read_thread_seq: 2, unread_count: 0 }),
          });

          expect(await panel().findByText("返信 2")).toBeInTheDocument();
          expect(panel().getByText("親のメッセージ")).toBeInTheDocument();
          expect(panel().getByText("2 件の返信")).toBeInTheDocument();
          // パネルの中では「返信」を出さない（入れ子にしない）
          expect(panel().queryByRole("button", { name: "返信", hidden: true })).not.toBeInTheDocument();
          await waitFor(() =>
            expect(api.calls.filter((c) => c.path === "/api/v1/rooms/r-design/threads/m-2/read").map((c) => JSON.parse(c.init.body as string))).toEqual([{ seq: 5 }]),
          );

          await userEvent.click(panel().getByRole("button", { name: "スレッドを閉じる" }));
          expect(nav.router.replace).toHaveBeenLastCalledWith("/w/ws-1/r/r-design");
        });

        it("sends a reply to the thread, not to the channel", async () => {
          nav.search = "thread=m-2";
          const sent: unknown[] = [];
          await connected({
            ...openRoom(design, [message(1), root, message(3)]),
            ...threadRoute(),
            "POST /api/v1/rooms/r-design/messages": (_url, init) => {
              const req = JSON.parse(init.body as string);
              sent.push(req);
              return json(201, message(6, { room_id: "r-design", change_seq: 6, sender: naoki, client_msg_id: req.client_msg_id, body: req.body, thread_root_id: "m-2", thread_seq: 3 }));
            },
          });
          await panel().findByText("返信 2");

          await userEvent.type(screen.getByRole("textbox", { name: "スレッドに返信" }), "スレッドで答えます{Enter}");

          expect(await panel().findByText("スレッドで答えます")).toBeInTheDocument();
          expect(sent).toEqual([expect.objectContaining({ body: "スレッドで答えます", thread_root_id: "m-2" })]);
          expect(history().queryByText("スレッドで答えます")).not.toBeInTheDocument();
        });

        describe("チャンネルにも投稿する（ADR 0039）", () => {
          function sendRouteWithFlag(sent: unknown[]): Record<string, Handler> {
            return {
              "POST /api/v1/rooms/r-design/messages": (_url, init) => {
                const req = JSON.parse(init.body as string);
                sent.push(req);
                return json(201, message(6, {
                  room_id: "r-design", change_seq: 6, user_seq: 4, sender: naoki, client_msg_id: req.client_msg_id,
                  body: req.body, thread_root_id: "m-2", thread_seq: 3, also_in_channel: req.also_in_channel,
                }));
              },
            };
          }

          it("sends the reply to the channel too when the box is checked, and shows it in both", async () => {
            nav.search = "thread=m-2";
            const sent: unknown[] = [];
            await connected({ ...openRoom(design, [message(1), root, message(3)]), ...threadRoute(), ...sendRouteWithFlag(sent) });
            await panel().findByText("返信 2");

            await userEvent.click(screen.getByRole("checkbox", { name: "チャンネルにも投稿する" }));
            await userEvent.type(screen.getByRole("textbox", { name: "スレッドに返信" }), "みんなにも伝えます{Enter}");

            await waitFor(() => expect(sent).toEqual([expect.objectContaining({ thread_root_id: "m-2", also_in_channel: true })]));
            expect(await history().findByText("みんなにも伝えます")).toBeInTheDocument();
            expect(panel().getByText("チャンネルにも投稿しました")).toBeInTheDocument();
            expect(history().getByRole("button", { name: "スレッドに返信しました" })).toBeInTheDocument();
            // 送るたびにチェックは外す（次の返信が知らずに流れないように）
            expect(screen.getByRole("checkbox", { name: "チャンネルにも投稿する" })).not.toBeChecked();
          });

          it("leaves the reply in the thread when the box is not checked", async () => {
            nav.search = "thread=m-2";
            const sent: unknown[] = [];
            await connected({ ...openRoom(design, [message(1), root, message(3)]), ...threadRoute(), ...sendRouteWithFlag(sent) });
            await panel().findByText("返信 2");

            await userEvent.type(screen.getByRole("textbox", { name: "スレッドに返信" }), "スレッドだけ{Enter}");

            await waitFor(() => expect(sent).toEqual([expect.objectContaining({ also_in_channel: false })]));
            expect(await panel().findByText("スレッドだけ")).toBeInTheDocument();
            expect(history().queryByText("スレッドだけ")).not.toBeInTheDocument();
          });

          it("asks before @channel only when the reply also goes to the channel (ADR 0041 / 0043)", async () => {
            nav.search = "thread=m-2";
            const sent: unknown[] = [];
            await connected({ ...openRoom(design, [message(1), root, message(3)]), ...threadRoute(), ...sendRouteWithFlag(sent) });
            await panel().findByText("返信 2");

            // スレッドだけの返信では @channel は誰にも飛ばないので、確認を出さずにそのまま送る
            await userEvent.type(screen.getByRole("textbox", { name: "スレッドに返信" }), "@channel スレッドだけ{Enter}");
            await waitFor(() => expect(sent).toHaveLength(1));
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(sent[0]).toMatchObject({ body: "<!channel> スレッドだけ", also_in_channel: false });

            await userEvent.click(screen.getByRole("checkbox", { name: "チャンネルにも投稿する" }));
            await userEvent.type(screen.getByRole("textbox", { name: "スレッドに返信" }), "@channel みんなにも{Enter}");
            await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "送信する" }));

            await waitFor(() => expect(sent).toHaveLength(2));
            expect(sent[1]).toMatchObject({ body: "<!channel> みんなにも", also_in_channel: true });
          });

          it("opens the thread from the label on the channel row", async () => {
            const broadcast = message(4, {
              room_id: "r-design", change_seq: 4, user_seq: 4, body: "流した返信",
              thread_root_id: "m-2", thread_seq: 1, also_in_channel: true,
            });
            await connected(openRoom(design, [message(1), root, broadcast]));

            expect(history().getByText("流した返信")).toBeInTheDocument();
            await userEvent.click(history().getByRole("button", { name: "スレッドに返信しました" }));

            expect(nav.router.push).toHaveBeenLastCalledWith("/w/ws-1/r/r-design?thread=m-2");
          });
        });

        it("shows typing in the thread only in the panel", async () => {
          nav.search = "thread=m-2";
          const { sockets } = await connected({ ...openRoom(design, [message(1), root, message(3)]), ...threadRoute() });
          await panel().findByText("返信 2");

          sockets.last().receive({ type: "typing.started", data: { workspace_id: "ws-1", room_id: "r-design", thread_root_id: "m-2", user: miyuki } });

          expect(await panel().findByText("高橋 みゆき が入力中")).toBeInTheDocument();
          expect(screen.getAllByText("高橋 みゆき が入力中")).toHaveLength(1);
        });

        it("counts unread threads in the sidebar and updates them from events", async () => {
          const { sockets } = await connected({
            ...openRoom(design, [message(1), root, message(3)]),
            "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [followed(0)], next_cursor: null }),
          });
          const threadsLink = () => sidebar().getByRole("link", { name: /スレッド/ });
          await waitFor(() => expect(threadsLink()).toHaveAttribute("href", "/w/ws-1/threads"));
          expect(within(threadsLink()).queryByLabelText(/未読/)).not.toBeInTheDocument();

          // 返信（change_seq 4）と、返信数の増えた親（5）が続けて届く
          sockets.last().receive({
            type: "message.created",
            data: message(4, { room_id: "r-design", change_seq: 4, body: "新しい返信", thread_root_id: "m-2", thread_seq: 3 }),
          });
          sockets.last().receive({
            type: "message.updated",
            data: { ...root, change_seq: 5, thread: { reply_count: 3, last_thread_seq: 3, last_reply_at: "2026-09-13T02:00:00Z" } },
          });

          expect(await within(threadsLink()).findByLabelText("未読 1 件")).toBeInTheDocument();
          expect(within(history().getAllByRole("article")[1]!).getByRole("button", { name: /3 件の返信/ })).toBeInTheDocument();
          expect(history().queryByText("新しい返信")).not.toBeInTheDocument();

          // 別の端末で読んだ
          sockets.last().receive({
            type: "thread.read",
            data: { workspace_id: "ws-1", room_id: "r-design", thread_root_id: "m-2", last_read_thread_seq: 3, unread_count: 0 },
          });
          await waitFor(() => expect(within(threadsLink()).queryByLabelText(/未読/)).not.toBeInTheDocument());
        });

        it("lists the followed threads and links each to its room with the panel open", async () => {
          nav.params = { workspaceId: "ws-1" };
          nav.pathname = "/w/ws-1/threads";
          renderWithChat(
            <WorkspaceScreen />,
            routes({
              "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [followed(1)], next_cursor: null }),
            }),
          );

          const list = await screen.findByRole("list", { name: "参加しているスレッド" });
          const link = within(list).getByRole("link");
          expect(link).toHaveAttribute("href", "/w/ws-1/r/r-design?thread=m-2");
          expect(link).toHaveTextContent("親のメッセージ");
          expect(within(link).getByLabelText("未読 1 件")).toBeInTheDocument();
          expect(sidebar().getByRole("link", { name: /スレッド/ })).toHaveAttribute("aria-current", "page");
          // 一覧を開いているときは、ルームへ移さない
          expect(nav.router.replace).not.toHaveBeenCalled();
        });
      });

      it("edits my own message in place", async () => {
        const mine = message(3, { sender: naoki, body: "書き間違い" });
        await connected({
          ...openRoom(design, [message(1), message(2), mine]),
          "PATCH /api/v1/rooms/r-design/messages/m-3": (_url, init) =>
            json(200, { ...mine, room_id: "r-design", change_seq: 4, body: JSON.parse(init.body as string).body, edited_at: "2026-09-13T02:00:00Z" }),
        });

        const article = history().getAllByRole("article")[2]!;
        // 他人のメッセージの「…」には「リンクをコピー」しかない（member なので編集も削除もできない。ADR 0012 / 0040）
        const others = history().getAllByRole("article")[1]!;
        await userEvent.click(within(others).getByRole("button", { name: "その他の操作" }));
        expect(screen.getByRole("button", { name: "リンクをコピー" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "メッセージを編集" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "メッセージを削除" })).not.toBeInTheDocument();
        await userEvent.click(within(others).getByRole("button", { name: "その他の操作" }));

        await userEvent.click(within(article).getByRole("button", { name: "その他の操作" }));
        await userEvent.click(screen.getByRole("button", { name: "メッセージを編集" }));
        const editor = screen.getByRole("textbox", { name: "メッセージを編集" });
        await userEvent.clear(editor);
        await userEvent.type(editor, "書き直し{Enter}");

        expect(await history().findByText("（編集済み）")).toBeInTheDocument();
        expect(history().getByText(/書き直し/)).toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: "メッセージを編集" })).not.toBeInTheDocument();
      });

      it("deletes a message after confirming", async () => {
        const mine = message(3, { sender: naoki, body: "消すメッセージ" });
        const { api } = await connected({
          ...openRoom(design, [message(1), message(2), mine]),
          "DELETE /api/v1/rooms/r-design/messages/m-3": () => new Response(null, { status: 204 }),
          "GET /api/v1/rooms/r-design/messages?after_change_seq=3&limit=100": () =>
            json(200, {
              messages: api.paths().includes("DELETE /api/v1/rooms/r-design/messages/m-3")
                ? [{ ...mine, room_id: "r-design", body: "", change_seq: 4, deleted_at: "2026-09-13T02:00:00Z" }]
                : [],
              has_more: false,
              last_change_seq: api.paths().includes("DELETE /api/v1/rooms/r-design/messages/m-3") ? 4 : 3,
            }),
        });

        await userEvent.click(within(history().getAllByRole("article")[2]!).getByRole("button", { name: "その他の操作" }));
        await userEvent.click(screen.getByRole("button", { name: "メッセージを削除" }));
        const dialog = screen.getByRole("dialog", { name: "メッセージを削除しますか？" });
        expect(within(dialog).getByText("消すメッセージ")).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: "削除する" }));

        // 削除したメッセージは跡を残さずに消える（ADR 0038）
        await waitFor(() => expect(history().queryByText("消すメッセージ")).not.toBeInTheDocument());
        expect(history().getAllByRole("article")).toHaveLength(2);
        expect(history().queryByText("このメッセージは削除されました")).not.toBeInTheDocument();
        expect(screen.queryByRole("dialog", { name: "メッセージを削除しますか？" })).not.toBeInTheDocument();
        // サイドバーの最後の 1 行は、ひとつ前のメッセージを取り直す
        await waitFor(() => expect(api.paths().filter((p) => p === "GET /api/v1/rooms/r-design")).toHaveLength(2));
      });

      describe("メッセージへのリンク（ADR 0040）", () => {
        /** jsdom には clipboard がないので、書き込み先だけ差し替える。 */
        function stubClipboard() {
          const writeText = vi.fn(async () => {});
          Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
          return writeText;
        }

        // パーマリンクは ULID しか受けない（links.ts）ので、リンク先だけ ULID の ID にする。
        // リンク先のルームはサイドバーになくてよい。カードの中身は、見る人の権限で API が返したものだけで決まる
        const LINK_WS = "01J9ZQZQZQZQZQZQZQZQZQZQZA";
        const LINK_ROOM = "01J9ZQZQZQZQZQZQZQZQZQZQZB";
        const LINK_MSG = "01J9ZQZQZQZQZQZQZQZQZQZQZC";
        const HIDDEN_ROOM = "01J9ZQZQZQZQZQZQZQZQZQZQZD";
        const HIDDEN_MSG = "01J9ZQZQZQZQZQZQZQZQZQZQZE";

        it("「リンクをコピー」で、そのメッセージを指す URL がクリップボードに入る", async () => {
          const writeText = stubClipboard();
          await connected();

          await userEvent.click(within(history().getAllByRole("article")[1]!).getByRole("button", { name: "その他の操作" }));
          await userEvent.click(screen.getByRole("button", { name: "リンクをコピー" }));

          expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/w/ws-1/r/r-design?m=m-2`);
          // コピーできたことは、同じ行の文言で知らせる（ADR 0040）
          expect(await screen.findByRole("button", { name: "コピーしました" })).toBeInTheDocument();
        });

        it("スレッドの返信のリンクには、開く親の ID が付く", async () => {
          const writeText = stubClipboard();
          const reply = message(3, { thread_root_id: "m-1", thread_seq: 1, also_in_channel: true, body: "チャンネルにも流した返信" });
          await connected(openRoom(design, [message(1), message(2), reply]));

          await userEvent.click(within(history().getAllByRole("article")[2]!).getByRole("button", { name: "その他の操作" }));
          await userEvent.click(screen.getByRole("button", { name: "リンクをコピー" }));

          expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/w/ws-1/r/r-design?m=m-3&t=m-1`);
        });

        it("本文に貼ったリンクをカードにし、読めないリンクは中身を出さない", async () => {
          const readable = `${window.location.origin}/w/${LINK_WS}/r/${LINK_ROOM}?m=${LINK_MSG}`;
          const hidden = `${window.location.origin}/w/${LINK_WS}/r/${HIDDEN_ROOM}?m=${HIDDEN_MSG}`;
          const { api } = await connected({
            ...openRoom(design, [message(1), message(2, { body: `これです ${readable} と ${hidden}` }), message(3)]),
            "POST /api/v1/messages/links": () =>
              json(200, {
                links: [
                  {
                    room_id: LINK_ROOM,
                    message_id: LINK_MSG,
                    status: "ok",
                    workspace: { id: LINK_WS, name: "山と印刷" },
                    room: { id: LINK_ROOM, kind: "public", name: "雑談", dm_peer: null },
                    message: {
                      id: LINK_MSG,
                      seq: 7,
                      sender: miyuki,
                      body: "つなぎの議事録",
                      thread_root_id: null,
                      attachment_count: 0,
                      created_at: "2026-09-13T01:30:00Z",
                      edited_at: null,
                      deleted_at: null,
                    },
                  },
                  // 読めない・存在しない・削除済みは、すべて同じ unavailable（ADR 0040）
                  { room_id: HIDDEN_ROOM, message_id: HIDDEN_MSG, status: "unavailable", workspace: null, room: null, message: null },
                ],
              }),
          });

          const card = await history().findByRole("article", { name: "高橋 みゆき のメッセージ" });
          expect(within(card).getByText("つなぎの議事録")).toBeInTheDocument();
          // 別のワークスペースなので、ルーム名にワークスペース名を添える
          expect(within(card).getByRole("link", { name: "山と印刷 / 雑談" })).toHaveAttribute("href", readable);
          expect(history().getByText("このメッセージは表示できません")).toBeInTheDocument();
          // 貼られた順に、1 回のリクエストでまとめて取る
          expect(JSON.parse(api.calls.find((c) => c.path === "/api/v1/messages/links")!.init.body as string)).toEqual({
            links: [
              { room_id: LINK_ROOM, message_id: LINK_MSG },
              { room_id: HIDDEN_ROOM, message_id: HIDDEN_MSG },
            ],
          });
        });
      });
    });

    it("shows who is typing", async () => {
      const { sockets } = await connected();

      sockets.last().receive({ type: "typing.started", data: { workspace_id: "ws-1", room_id: "r-design", thread_root_id: null, user: miyuki } });

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

    it("shows only that the channel cannot be accessed when removed from a private channel, without its name", async () => {
      const secret = { ...design, kind: "private" as const };
      rememberLocation("ws-1", "r-design");
      const { sockets } = await connected({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [secret, chat, dm] }),
        ...openRoom(secret),
        "GET /api/v1/rooms/r-design/members?limit=200": () => json(200, { members: [roomMember(naoki)], next_cursor: null }),
      });
      await userEvent.click(screen.getByRole("button", { name: "メンバー" }));
      expect(await screen.findByRole("complementary", { name: "メンバー" })).toBeInTheDocument();

      sockets.last().receive({
        type: "room.member_removed",
        data: { workspace_id: "ws-1", room_id: "r-design", reason: "removed" },
      });

      expect(await screen.findByRole("heading", { name: "このチャンネルにはアクセスできません" })).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "メッセージ" })).not.toBeInTheDocument();
      // 名前はヘッダーにもサイドバーにも出さず、「外された」とも言わない。メンバーのパネルも閉じる（ADR 0035）
      expect(screen.queryByText(/デザインレビュー/)).not.toBeInTheDocument();
      expect(screen.queryByText(/外され/)).not.toBeInTheDocument();
      expect(screen.queryByRole("complementary", { name: "メンバー" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "チャンネル一覧に戻る" }));
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
      expect(screen.getByRole("button", { name: "チャンネルの設定" })).toBeInTheDocument();

      sockets.last().receive({
        type: "workspace.member_removed",
        data: { workspace_id: "ws-1", user_id: naoki.id, reason: "removed" },
      });

      expect(await screen.findByRole("heading", { name: "ワークスペースから削除されました" })).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "メッセージ" })).not.toBeInTheDocument();
      // ヘッダーは名前とメンバーだけを残し、もう開けない設定の入口は出さない（chat/removed-from-workspace.png）
      expect(screen.queryByRole("button", { name: "チャンネルの設定" })).not.toBeInTheDocument();
      expect(nav.router.replace).not.toHaveBeenCalledWith("/");

      await userEvent.click(screen.getByRole("button", { name: "別のワークスペースに移動" }));
      expect(nav.router.replace).toHaveBeenCalledWith("/");
      expect(lastWorkspaceId()).toBeUndefined();
    });
  });

  describe("attachments and avatars", () => {
    beforeEach(() => {
      nav.params = { workspaceId: "ws-1", roomId: "r-design" };
    });

    const history = () => within(screen.getByRole("list", { name: "メッセージ" }));
    const expiresAt = "2026-09-17T01:00:00Z";

    it("uploads the chosen file straight to storage and sends it with the message", async () => {
      const puts: string[] = [];
      let finishPut!: () => void;
      const sent: unknown[] = [];
      const pdf = { id: "att-1", file_name: "scale.pdf", content_type: "application/pdf", size_bytes: 3, width: null, height: null };
      const { container } = renderWithChat(
        <WorkspaceScreen />,
        routes({
          ...openRoom(design),
          "POST /api/v1/rooms/r-design/attachments": () =>
            json(201, {
              attachment: { ...pdf, room_id: "r-design", status: "pending", created_at: "2026-09-17T00:00:00Z" },
              upload: { method: "PUT", url: "https://storage.test/att-1?sig=x", headers: { "Content-Type": "application/pdf" } },
            }),
          "POST /api/v1/attachments/att-1/complete": () =>
            json(200, { ...pdf, room_id: "r-design", status: "uploaded", created_at: "2026-09-17T00:00:00Z" }),
          "POST /api/v1/rooms/r-design/messages": (_url, init) => {
            const req = JSON.parse(init.body as string);
            sent.push(req);
            return json(201, message(4, { room_id: "r-design", change_seq: 4, sender: naoki, client_msg_id: req.client_msg_id, body: "", attachments: [pdf] }));
          },
        }),
        {
          upload: {
            putFile: (url, _headers, _file, { onProgress }) =>
              new Promise((resolve) => {
                puts.push(url);
                onProgress(0.5);
                finishPut = resolve;
              }),
          },
        },
      );
      await screen.findByRole("list", { name: "メッセージ" });

      await userEvent.upload(
        container.querySelector<HTMLInputElement>('input[type="file"]')!,
        new File(["pdf"], "scale.pdf", { type: "application/pdf" }),
      );

      expect(await screen.findByRole("progressbar", { name: "scale.pdf をアップロード中" })).toHaveAttribute("aria-valuenow", "50");
      expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
      expect(puts).toEqual(["https://storage.test/att-1?sig=x"]);

      finishPut();
      expect(await screen.findByRole("img", { name: "アップロード済み" })).toBeInTheDocument();
      // 添付があれば本文は空でも送れる
      await userEvent.click(screen.getByRole("button", { name: "送信" }));

      expect(screen.queryByRole("img", { name: "アップロード済み" })).not.toBeInTheDocument();
      await waitFor(() => expect(sent).toEqual([expect.objectContaining({ body: "", attachment_ids: ["att-1"] })]));
      expect(await history().findByText("scale.pdf")).toBeInTheDocument();
    });

    it("shows images and avatars once their urls are loaded, and downloads files with a fresh url", async () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const withFiles = [
        message(1, { attachments: [{ id: "img-1", file_name: "mock.png", content_type: "image/png", size_bytes: 10, width: 260, height: 160 }] }),
        message(2, { attachments: [{ id: "file-1", file_name: "scale.pdf", content_type: "application/pdf", size_bytes: 10, width: null, height: null }] }),
      ];
      renderWithChat(
        <WorkspaceScreen />,
        routes({
          ...openRoom(design, withFiles),
          "POST /api/v1/users/avatars": () =>
            json(200, { avatars: { [naoki.id]: { url: "https://storage.test/avatars/naoki", expires_at: expiresAt } } }),
          "GET /api/v1/attachments/img-1/url": () => json(200, { url: "https://storage.test/img-1", expires_at: expiresAt }),
          "GET /api/v1/attachments/file-1/url": () => json(200, { url: "https://storage.test/file-1", expires_at: expiresAt }),
        }),
      );

      expect(await screen.findByRole("img", { name: "mock.png" })).toHaveAttribute("src", "https://storage.test/img-1");
      // DM の相手（佐藤 直樹）のアバターが画像になる
      await waitFor(() =>
        expect(
          sidebar()
            .getByRole("link", { name: /佐藤 直樹/ })
            .querySelector("img"),
        ).toHaveAttribute("src", "https://storage.test/avatars/naoki"),
      );

      await userEvent.click(history().getByRole("button", { name: "ダウンロード" }));
      await waitFor(() => expect(click).toHaveBeenCalledOnce());
      expect((click.mock.contexts[0] as HTMLAnchorElement).href).toBe("https://storage.test/file-1");
    });
  });
});
