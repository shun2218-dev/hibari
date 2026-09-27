import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PastHuddle, RoomHuddle } from "@/lib/api/types.gen";
import { kei, member, miyuki, naoki, room, workspace } from "@/test/chat-data";
import { type Handler, json } from "@/test/fake-api";
import { renderWithChat } from "@/test/render-with-chat";

import { WorkspaceScreen } from "./workspace-screen";

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  params: { workspaceId: "ws-1" } as { workspaceId: string; roomId?: string },
  pathname: "/w/ws-1/huddles",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useParams: () => nav.params,
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => nav.pathname,
}));

function liveHuddle(roomId: string, userIds: string[]): RoomHuddle {
  return {
    id: `h-live-${roomId}`,
    room_id: roomId,
    message_id: `m-live-${roomId}`,
    started_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    version: 1,
    participants: userIds.map((user_id) => ({ user_id, muted: false })),
    joining_soon: [],
  };
}

function past(id: string, overrides: Partial<PastHuddle> = {}): PastHuddle {
  return {
    id,
    message_id: `m-${id}`,
    started_by: naoki.id,
    room: { id: "r-design", kind: "public", name: "デザインレビュー" },
    started_at: "2026-09-26T02:00:00Z",
    ended_at: "2026-09-26T02:38:00Z",
    participant_ids: [naoki.id, miyuki.id],
    reply_count: 6,
    saved: false,
    ...overrides,
  };
}

const design = room("r-design", "デザインレビュー");
const chat = room("r-chat", "雑談", { huddle: liveHuddle("r-chat", [miyuki.id]) });

function routes(overrides: Record<string, Handler> = {}) {
  return {
    "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
    "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [design, chat], unread_thread_count: 0 }),
    "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [], next_cursor: null }),
    "GET /api/v1/workspaces/ws-1/members?limit=200": () =>
      json(200, { members: [member(naoki, { role: "owner" }), member(miyuki), member(kei)], next_cursor: null }),
    "GET /api/v1/workspaces/ws-1/saved?state=in_progress&limit=50": () =>
      json(200, { items: [], in_progress_count: 0, last_change_seq: 0, has_more: false }),
    "GET /api/v1/workspaces/ws-1/me/notifications": () => json(200, { level: "mentions" }),
    "GET /api/v1/workspaces/ws-1/activity/unread_count": () => json(200, { count: 0 }),
    "GET /api/v1/features": () => json(200, { huddles: true }),
    "GET /api/v1/workspaces/ws-1/huddles": () => json(200, { huddles: [past("h-2"), past("h-1", { reply_count: 0 })], next_cursor: null }),
    "GET /api/v1/workspaces/ws-1/huddles?filter=missed": () => json(200, { huddles: [past("h-missed")], next_cursor: null }),
    "GET /api/v1/workspaces/ws-1/huddles/suggestions": () =>
      json(200, { suggestions: [{ room: { id: "r-design", kind: "public", name: "デザインレビュー" }, count: 3, participant_ids: [kei.id] }] }),
    ...overrides,
  };
}

async function openList(overrides: Record<string, Handler> = {}) {
  const result = renderWithChat(<WorkspaceScreen />, routes(overrides), { huddle: true });
  await screen.findByRole("list", { name: "最近のハドルミーティング" });
  return result;
}

describe("ハドルの一覧（ADR 0067 決定 6〜8）", () => {
  beforeEach(() => {
    nav.router.replace.mockReset();
    nav.router.push.mockReset();
    window.localStorage.clear();
  });

  it("サイドバーの行を選び、進行中のカード・提案のカード・最近のハドルミーティングを出す", async () => {
    await openList();

    const nav = within(screen.getByRole("navigation", { name: "チャンネル" }))
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/w/ws-1/huddles")!;
    expect(nav).toHaveTextContent("ハドルミーティング");
    expect(nav).toHaveAttribute("aria-current", "page");
    // 進行中のハドルに入っている人の顔を、サイドバーの行にも出す
    expect(within(nav).getByRole("img", { name: "進行中のハドルミーティングに 1 人" })).toBeInTheDocument();

    expect(screen.getByRole("article", { name: "雑談 のハドルミーティング（進行中）" })).toHaveTextContent("12 分");
    expect(await screen.findByText("過去 1 週間にここで 3 回ハドルミーティングを実施しました")).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "最近のハドルミーティング" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("link", { name: "6 件の返信" })).toHaveAttribute("href", "/w/ws-1/r/r-design?t=m-h-2");
  });

  it("範囲を「参加しなかった」にすると、その条件で取り直す", async () => {
    const user = userEvent.setup();
    const { api } = await openList();

    await user.click(screen.getByRole("button", { name: "すべてのハドルミーティング" }));
    await user.click(within(screen.getByRole("dialog", { name: "範囲" })).getByRole("button", { name: "参加しなかったハドルミーティング" }));

    await waitFor(() => expect(api.paths()).toContain("GET /api/v1/workspaces/ws-1/huddles?filter=missed"));
    const rows = await within(screen.getByRole("list", { name: "最近のハドルミーティング" })).findAllByRole("listitem");
    expect(rows).toHaveLength(1);
  });

  it("行の「…」から「後で」に保存し、リンクをコピーする", async () => {
    const user = userEvent.setup();
    const { api } = await openList({
      "PUT /api/v1/rooms/r-design/messages/m-h-2/saved": () =>
        json(200, {
          id: "s-1",
          workspace_id: "ws-1",
          message_id: "m-h-2",
          room_id: "r-design",
          state: "in_progress",
          change_seq: 1,
          saved_at: "2026-09-26T03:00:00Z",
          status: "ok",
          room: null,
          message: null,
        }),
    });

    const [row] = within(screen.getByRole("list", { name: "最近のハドルミーティング" })).getAllByRole("listitem");
    await user.click(within(row).getByRole("button", { name: "その他の操作" }));
    await user.click(screen.getByRole("button", { name: "「後で」に保存" }));
    await waitFor(() => expect(api.paths()).toContain("PUT /api/v1/rooms/r-design/messages/m-h-2/saved"));

    await user.click(within(row).getByRole("button", { name: "その他の操作" }));
    expect(screen.getByRole("button", { name: "「後で」から外す" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ハドルミーティングのリンクをコピー" }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/w/ws-1/r/r-design?huddle=1`);
  });

  it("「新規ハドルミーティング」でチャンネルを選ぶと、参加前のプレビューを出す", async () => {
    const user = userEvent.setup();
    await openList();

    await user.click(screen.getAllByRole("button", { name: "新規ハドルミーティング" })[0]);
    const dialog = screen.getByRole("dialog", { name: "ハドルミーティングにメンバーを招待する" });
    await user.type(within(dialog).getByRole("searchbox"), "デザ");
    await user.click(within(dialog).getByRole("radio", { name: /デザインレビュー/ }));
    await user.click(within(dialog).getByRole("button", { name: "ハドルミーティングを開始する" }));

    const overlay = await screen.findByRole("dialog", { name: "ハドルミーティング" });
    expect(within(overlay).getByRole("heading")).toHaveTextContent("デザインレビュー");
  });

  it("進行中のハドルが終わったら、最近のハドルミーティングを取り直す", async () => {
    const { api, sockets } = await openList();
    const before = api.paths().filter((p) => p === "GET /api/v1/workspaces/ws-1/huddles").length;

    await waitFor(() => expect(sockets.sockets).toHaveLength(1));
    sockets.last().open();
    await waitFor(() => expect(sockets.last().messages()).toContainEqual({ type: "subscribe", room_id: "r-chat" }));
    sockets.last().receive({ type: "huddle.updated", data: { room_id: "r-chat", huddle: null } });

    await waitFor(() => expect(api.paths().filter((p) => p === "GET /api/v1/workspaces/ws-1/huddles").length).toBe(before + 1));
  });
});
