import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { miyuki, workspace } from "@/test/chat-data";
import { type Handler, json, problem } from "@/test/fake-api";
import { renderWithChat } from "@/test/render-with-chat";

import { InvitePage } from "./invite-page";

const nav = vi.hoisted(() => ({ router: { replace: vi.fn(), push: vi.fn() }, params: { code: "7Qv2xkR8mA" } }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, useParams: () => nav.params }));

const preview = {
  workspace: { id: "ws-1", name: "山と印刷", member_count: 6, public_room_count: 3 },
  inviter: miyuki,
  already_member: false,
  expires_at: "2026-09-20T09:00:00Z",
};

function renderInvite(routes: Record<string, Handler>) {
  return renderWithChat(<InvitePage />, routes);
}

describe("InvitePage", () => {
  beforeEach(() => {
    nav.router.replace.mockReset();
    nav.params = { code: "7Qv2xkR8mA" };
  });

  it("shows the workspace and who invited you, then joins and opens it", async () => {
    const user = userEvent.setup();
    const { api } = renderInvite({
      "GET /api/v1/invites/7Qv2xkR8mA": () => json(200, preview),
      "POST /api/v1/invites/7Qv2xkR8mA/accept": () =>
        json(200, { workspace: workspace("ws-1", "山と印刷"), already_member: false }),
    });

    expect(await screen.findByRole("heading", { name: "山と印刷" })).toBeInTheDocument();
    expect(screen.getByText("6人のメンバー · 3 チャンネル")).toBeInTheDocument();
    expect(screen.getByText(/高橋 みゆき/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "参加する" }));

    await waitFor(() => expect(api.paths()).toContain("POST /api/v1/invites/7Qv2xkR8mA/accept"));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1"));
  });

  it("does not ask again when the viewer is already a member", async () => {
    const user = userEvent.setup();
    const { api } = renderInvite({ "GET /api/v1/invites/7Qv2xkR8mA": () => json(200, { ...preview, already_member: true }) });

    expect(await screen.findByText("すでに参加しています")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "開く" }));

    expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1");
    expect(api.paths()).not.toContain("POST /api/v1/invites/7Qv2xkR8mA/accept");
  });

  it.each([
    ["invite-invalid", 404, "この招待リンクは使えません"],
    ["invite-expired", 410, "リンクの有効期限が切れています"],
    ["invite-exhausted", 410, "このリンクは使用上限に達しました"],
    ["not-found", 404, "この招待リンクは使えません"],
  ])("explains %s without naming the workspace", async (type, status, title) => {
    renderInvite({ "GET /api/v1/invites/7Qv2xkR8mA": () => problem(status, type) });

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByText("山と印刷")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ホームに戻る" })).toHaveAttribute("href", "/");
  });

  it("switches to the expired screen when the link dies while it is open", async () => {
    const user = userEvent.setup();
    renderInvite({
      "GET /api/v1/invites/7Qv2xkR8mA": () => json(200, preview),
      "POST /api/v1/invites/7Qv2xkR8mA/accept": () => problem(410, "invite-expired"),
    });

    await user.click(await screen.findByRole("button", { name: "参加する" }));

    expect(await screen.findByText("リンクの有効期限が切れています")).toBeInTheDocument();
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("draws nothing when the server cannot be reached", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderInvite({ "GET /api/v1/invites/7Qv2xkR8mA": () => problem(500, "internal") });

    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    error.mockRestore();
  });

  it("lets the viewer sign out to open the invite as someone else", async () => {
    const user = userEvent.setup();
    const { api } = renderInvite({
      "GET /api/v1/invites/7Qv2xkR8mA": () => json(200, preview),
      "POST /api/v1/auth/logout": () => new Response(null, { status: 204 }),
    });

    await user.click(await screen.findByRole("button", { name: "ログアウト" }));

    await waitFor(() => expect(api.paths()).toContain("POST /api/v1/auth/logout"));
  });
});
