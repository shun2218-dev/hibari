import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Room, RoomHuddle } from "@/lib/api/types.gen";
import { kei, member, message, miyuki, naoki, room, roomMember, workspace } from "@/test/chat-data";
import { type Handler, json } from "@/test/fake-api";
import { renderWithChat } from "@/test/render-with-chat";

import { WorkspaceScreen } from "./workspace-screen";

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  params: {} as { workspaceId: string; roomId?: string },
  search: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useParams: () => nav.params,
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => `/w/${nav.params.workspaceId}/r/${nav.params.roomId}`,
}));

const design = room("r-design", "デザインレビュー");
const dm = room("r-dm", "", { kind: "dm", name: null, dm_peer: { ...miyuki, presence: "active" } });

function huddle(userIds: string[], overrides: Partial<RoomHuddle> = {}): RoomHuddle {
  return {
    id: "h-1",
    room_id: "r-design",
    message_id: "m-h",
    started_at: "2026-09-26T02:20:00Z",
    version: 1,
    participants: userIds.map((user_id) => ({ user_id, muted: false })),
    joining_soon: [],
    ...overrides,
  };
}

function routes({ huddles = true, rooms = [design, dm] }: { huddles?: boolean; rooms?: Room[] } = {}, overrides: Record<string, Handler> = {}) {
  return {
    "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
    "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms, unread_thread_count: 0 }),
    "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [], next_cursor: null }),
    "GET /api/v1/workspaces/ws-1/members?limit=200": () =>
      json(200, { members: [member(naoki, { role: "owner" }), member(miyuki), member(kei)], next_cursor: null }),
    "GET /api/v1/workspaces/ws-1/saved?state=in_progress&limit=50": () =>
      json(200, { items: [], in_progress_count: 0, last_change_seq: 0, has_more: false }),
    "GET /api/v1/workspaces/ws-1/me/notifications": () => json(200, { level: "mentions" }),
    "GET /api/v1/workspaces/ws-1/activity/unread_count": () => json(200, { count: 0 }),
    "GET /api/v1/features": () => json(200, { huddles }),
    "GET /api/v1/rooms/r-design": () => json(200, { ...design, member_count: 3 }),
    "GET /api/v1/rooms/r-design/messages?limit=50": () =>
      json(200, { messages: [message(1, { room_id: "r-design" })], has_more: false, last_change_seq: 1 }),
    "POST /api/v1/rooms/r-design/read": () => json(200, { last_read_seq: 1, last_read_user_seq: 1, unread_count: 0, mention_count: 0 }),
    "GET /api/v1/rooms/r-design/members?limit=200": () =>
      json(200, { members: [roomMember(naoki, { role: "owner" }), roomMember(miyuki), roomMember(kei)], next_cursor: null }),
    "GET /api/v1/rooms/r-design/pins": () => json(200, { messages: [] }),
    "POST /api/v1/rooms/r-design/huddle/ice-servers": () =>
      json(200, { ice_servers: [{ urls: ["turn:turn.example"] }], expires_at: "2026-09-27T00:00:00Z" }),
    "POST /api/v1/rooms/r-design/huddle/participants": () =>
      json(201, { huddle: huddle([naoki.id]), participant_id: "p-1", answer: { type: "answer", sdp: "answer" } }),
    "DELETE /api/v1/huddles/h-1/participants/p-1": () => new Response(null, { status: 204 }),
    ...overrides,
  };
}

async function openDesign(options: Parameters<typeof routes>[0] = {}, overrides: Record<string, Handler> = {}) {
  const result = renderWithChat(<WorkspaceScreen />, routes(options, overrides), { huddle: true });
  await screen.findByRole("list", { name: "メッセージ" });
  // イベント（huddle.updated など）を受けるために、WebSocket をつないで購読させる
  await waitFor(() => expect(result.sockets.sockets).toHaveLength(1));
  result.sockets.last().open();
  await waitFor(() => expect(result.sockets.last().messages()).toContainEqual({ type: "subscribe", room_id: "r-design" }));
  return result;
}

describe("音声のハドル（ADR 0066）", () => {
  beforeEach(() => {
    nav.router.replace.mockReset();
    nav.router.push.mockReset();
    nav.params = { workspaceId: "ws-1", roomId: "r-design" };
    nav.search = "";
    window.localStorage.clear();
  });

  it("ヘッダーのボタンで参加前のプレビューを出し、開始するとハドルの画面になり、退出すると閉じる", async () => {
    const user = userEvent.setup();
    const { api, sockets } = await openDesign();

    await user.click(await screen.findByRole("button", { name: "ハドルミーティングを開始する" }));
    const overlay = await screen.findByRole("dialog", { name: "ハドルミーティング" });
    await user.click(await within(overlay).findByRole("button", { name: "ハドルミーティングを開始する" }));

    await waitFor(() => expect(api.paths()).toContain("POST /api/v1/rooms/r-design/huddle/participants"));
    expect(JSON.parse(api.calls.find((c) => c.path.endsWith("/huddle/participants"))!.init.body as string)).toEqual({
      offer: { type: "offer", sdp: "offer" },
      mid: "0",
    });
    // 入ったことは huddle.updated で届く。ヘッダーのボタンは、押すと画面を出す緑のボタンになる
    sockets.last().receive({ type: "huddle.updated", data: { room_id: "r-design", huddle: huddle([naoki.id]) } });
    expect(await within(overlay).findByRole("list", { name: "参加者" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "ハドルミーティングの画面を表示する" })).toBeInTheDocument();

    await user.click(within(overlay).getByRole("button", { name: "退出する" }));
    await waitFor(() => expect(api.paths()).toContain("DELETE /api/v1/huddles/h-1/participants/p-1"));
    expect(screen.queryByRole("dialog", { name: "ハドルミーティング" })).not.toBeInTheDocument();
  });

  it("プレビューのキャンセルでは入らない", async () => {
    const user = userEvent.setup();
    const { api } = await openDesign();

    await user.click(await screen.findByRole("button", { name: "ハドルミーティングを開始する" }));
    const overlay = await screen.findByRole("dialog", { name: "ハドルミーティング" });
    await user.click(await within(overlay).findByRole("button", { name: "キャンセル" }));

    expect(screen.queryByRole("dialog", { name: "ハドルミーティング" })).not.toBeInTheDocument();
    expect(api.paths()).not.toContain("POST /api/v1/rooms/r-design/huddle/participants");
  });

  it("進行中のハドルには、プレビューで「参加する」と出る", async () => {
    const user = userEvent.setup();
    await openDesign({ rooms: [{ ...design, huddle: huddle([miyuki.id]) }, dm] });

    await user.click(await screen.findByRole("button", { name: /ハドルミーティングに参加/ }));
    const overlay = await screen.findByRole("dialog", { name: "ハドルミーティング" });
    expect(await within(overlay).findByRole("button", { name: "ハドルミーティングに参加する" })).toBeInTheDocument();
  });

  it("サーバーでハドルを使えなければ、ヘッダーのボタンを出さない（決定 15）", async () => {
    const { api } = await openDesign({ huddles: false });
    await waitFor(() => expect(api.paths()).toContain("GET /api/v1/features"));
    expect(screen.queryByRole("button", { name: "ハドルミーティングを開始する" })).not.toBeInTheDocument();
  });

  it("⌘⇧H でハドルを始め、入っている間の ⌘⇧H で抜ける", async () => {
    const user = userEvent.setup();
    const { api } = await openDesign();
    await screen.findByRole("button", { name: "ハドルミーティングを開始する" });

    await user.keyboard("{Meta>}{Shift>}H{/Shift}{/Meta}");
    const overlay = await screen.findByRole("dialog", { name: "ハドルミーティング" });
    await user.click(await within(overlay).findByRole("button", { name: "ハドルミーティングを開始する" }));
    await waitFor(() => expect(api.paths()).toContain("POST /api/v1/rooms/r-design/huddle/participants"));
    await within(overlay).findByRole("button", { name: "退出する" });

    await user.keyboard("{Meta>}{Shift>}H{/Shift}{/Meta}");
    await waitFor(() => expect(api.paths()).toContain("DELETE /api/v1/huddles/h-1/participants/p-1"));
  });

  it("DM の呼び出しを出し、「もうすぐ参加する」で止める（決定 11）", async () => {
    const user = userEvent.setup();
    const { api, sockets } = await openDesign({}, { "POST /api/v1/huddles/h-9/joining-soon": () => new Response(null, { status: 204 }) });

    sockets.last().receive({ type: "huddle.ringing", data: { room_id: "r-dm", huddle_id: "h-9", caller_id: miyuki.id } });
    const ring = await screen.findByRole("alertdialog", { name: `${miyuki.display_name} さんからのハドルミーティング` });
    await user.click(within(ring).getByRole("button", { name: "もうすぐ参加する" }));

    await waitFor(() => expect(api.paths()).toContain("POST /api/v1/huddles/h-9/joining-soon"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("自分の参加が外れた（huddle.left の removed）ら、知らせを出す（決定 8）", async () => {
    const user = userEvent.setup();
    const { api, sockets } = await openDesign();
    await user.click(await screen.findByRole("button", { name: "ハドルミーティングを開始する" }));
    const overlay = await screen.findByRole("dialog", { name: "ハドルミーティング" });
    await user.click(await within(overlay).findByRole("button", { name: "ハドルミーティングを開始する" }));
    await within(overlay).findByRole("button", { name: "退出する" });

    sockets.last().receive({
      type: "huddle.left",
      data: { room_id: "r-design", huddle_id: "h-1", participant_id: "p-1", reason: "removed" },
    });

    expect(await within(overlay).findByRole("alert")).toHaveTextContent("ハドルミーティングから外れました");
    // サーバーはもう外しているので、抜ける要求は送らない
    expect(api.paths()).not.toContain("DELETE /api/v1/huddles/h-1/participants/p-1");
  });
});
