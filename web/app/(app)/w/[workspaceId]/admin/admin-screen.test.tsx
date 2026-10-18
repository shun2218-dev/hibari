import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/lib/api/types.gen";
import { lastWorkspaceId, rememberLocation } from "@/lib/chat/last-location";
import { invite, member, miyuki, naoki, workspace } from "@/test/chat-data";
import { type Handler, json, problem } from "@/test/fake-api";
import { renderWithChat } from "@/test/render-with-chat";

import { AdminShell } from "@/app/(app)/w/[workspaceId]/admin/_components/admin-shell";
import { InvitesSection } from "@/app/(app)/w/[workspaceId]/admin/invites/_components/invites-section";
import { MembersSection } from "@/app/(app)/w/[workspaceId]/admin/members/_components/members-section";
import { SettingsSection } from "@/app/(app)/w/[workspaceId]/admin/settings/_components/settings-section";

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  params: { workspaceId: "ws-1" },
  pathname: "/w/ws-1/admin/settings",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useParams: () => nav.params,
  usePathname: () => nav.pathname,
}));

// 自分（naoki）が owner、高橋 みゆきが member のワークスペース。
const roster = [member(naoki, { role: "owner", presence: "active" }), member(miyuki, { role: "member" })];

function routes(overrides: Record<string, Handler> = {}, myRole: Role = "owner"): Record<string, Handler> {
  return {
    "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "山と印刷", { my_role: myRole })] }),
    "GET /api/v1/workspaces/ws-1/members?limit=200": () => json(200, { members: roster, next_cursor: null }),
    "GET /api/v1/workspaces/ws-1/invites?limit=200": () => json(200, { invites: [invite("i-1")], next_cursor: null }),
    ...overrides,
  };
}

function renderAdmin(section: ReactNode, handlers: Record<string, Handler> = {}, myRole: Role = "owner") {
  return renderWithChat(<AdminShell>{section}</AdminShell>, routes(handlers, myRole));
}

describe("the workspace admin screens", () => {
  beforeEach(() => {
    nav.router.replace.mockReset();
    nav.router.push.mockReset();
    nav.params = { workspaceId: "ws-1" };
    nav.pathname = "/w/ws-1/admin/settings";
    window.localStorage.clear();
  });

  it("shows the workspace, the counts and the way back to the chat", async () => {
    nav.pathname = "/w/ws-1/admin/members";
    renderAdmin(<MembersSection />);

    const nav_ = within(await screen.findByRole("navigation", { name: "ワークスペースの管理" }));
    await waitFor(() => expect(nav_.getByRole("link", { name: /メンバー/ })).toHaveTextContent("2"));
    expect(nav_.getByRole("link", { name: /招待リンク/ })).toHaveTextContent("1");
    expect(nav_.getByRole("link", { name: /メンバー/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "戻る" })).toHaveAttribute("href", "/w/ws-1");
  });

  it("sends the viewer back to the entrance when they are not a member", async () => {
    nav.params = { workspaceId: "ws-9" };
    renderWithChat(
      <AdminShell>
        <MembersSection />
      </AdminShell>,
      routes({
        "GET /api/v1/workspaces/ws-9/members?limit=200": () => problem(404, "not-found"),
        "GET /api/v1/workspaces/ws-9/invites?limit=200": () => problem(404, "not-found"),
      }),
    );

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/"));
  });

  describe("members", () => {
    beforeEach(() => {
      nav.pathname = "/w/ws-1/admin/members";
    });

    it("changes a role from the menu", async () => {
      const user = userEvent.setup();
      const { api } = renderAdmin(<MembersSection />, {
        [`PATCH /api/v1/workspaces/ws-1/members/${miyuki.id}`]: () => json(200, member(miyuki, { role: "admin" })),
      });

      await user.click(await screen.findByRole("button", { name: "高橋 みゆき のロールを変更" }));
      const menu = screen.getByRole("dialog", { name: "付与できるロール" });
      await user.click(within(menu).getByRole("button", { name: "管理者" }));

      await waitFor(() => expect(api.paths()).toContain(`PATCH /api/v1/workspaces/ws-1/members/${miyuki.id}`));
      const row = screen.getAllByRole("listitem").find((li) => li.textContent?.includes("高橋 みゆき"))!;
      await waitFor(() => expect(within(row).getByText("管理者")).toBeInTheDocument());
      // メニューは閉じる
      expect(screen.queryByRole("dialog", { name: "付与できるロール" })).not.toBeInTheDocument();
    });

    it("asks before kicking, then drops the member", async () => {
      const user = userEvent.setup();
      const { api } = renderAdmin(<MembersSection />, {
        [`DELETE /api/v1/workspaces/ws-1/members/${miyuki.id}`]: () => new Response(null, { status: 204 }),
      });

      await user.click(await screen.findByRole("button", { name: "高橋 みゆき のロールを変更" }));
      await user.click(screen.getByRole("button", { name: "ワークスペースから削除" }));
      expect(screen.getByRole("dialog")).toHaveTextContent("高橋 みゆき さんをこのワークスペースから削除します");
      await user.click(screen.getByRole("button", { name: "削除する" }));

      await waitFor(() => expect(api.paths()).toContain(`DELETE /api/v1/workspaces/ws-1/members/${miyuki.id}`));
      await waitFor(() => expect(screen.queryByText("高橋 みゆき")).not.toBeInTheDocument());
    });

    it("only offers the lock to a member who cannot manage anyone", async () => {
      const user = userEvent.setup();
      renderAdmin(<MembersSection />, {}, "member");

      await user.click(await screen.findByRole("button", { name: "高橋 みゆき を管理できない理由" }));
      expect(screen.getByText("自分と同じか上のロールのメンバーは変更できません。")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /ロールを変更/ })).not.toBeInTheDocument();
    });
  });

  describe("settings", () => {
    it("renames the workspace when the field loses focus, and changes the invite policy", async () => {
      const user = userEvent.setup();
      const { api } = renderAdmin(<SettingsSection />, {
        "PATCH /api/v1/workspaces/ws-1": (_url, init) =>
          json(200, workspace("ws-1", "山と印刷", { my_role: "owner", ...JSON.parse(init.body as string) })),
      });

      const field = await screen.findByLabelText("ワークスペース名");
      await user.clear(field);
      await user.type(field, "山と印刷 2");
      await user.tab();

      await waitFor(() => expect(api.calls.at(-1)?.init.body).toBe(JSON.stringify({ name: "山と印刷 2" })));

      await user.click(screen.getByRole("radio", { name: /全メンバー/ }));
      await waitFor(() => expect(api.calls.at(-1)?.init.body).toBe(JSON.stringify({ invite_policy: "all_members" })));
      await waitFor(() => expect(screen.getByRole("radio", { name: /全メンバー/ })).toBeChecked());
    });

    it("puts the name back when the rename fails", async () => {
      const user = userEvent.setup();
      renderAdmin(<SettingsSection />, { "PATCH /api/v1/workspaces/ws-1": () => problem(422, "validation-error") });

      const field = await screen.findByLabelText("ワークスペース名");
      await user.type(field, "!");
      await user.tab();

      await waitFor(() => expect(field).toHaveValue("山と印刷"));
    });

    it("makes the owner transfer before leaving, and leaves after the transfer", async () => {
      const user = userEvent.setup();
      const { api } = renderAdmin(<SettingsSection />, {
        "POST /api/v1/workspaces/ws-1/ownership-transfer": () => new Response(null, { status: 204 }),
      });

      await user.click(await screen.findByRole("button", { name: "退出する" }));
      const blocked = screen.getByRole("dialog");
      expect(blocked).toHaveTextContent("先にオーナーを譲渡してください");
      await user.click(within(blocked).getByRole("button", { name: "オーナーを譲渡" }));

      await user.click(await screen.findByRole("radio", { name: /高橋 みゆき/ }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "次へ" }));
      const confirm = screen.getByRole("dialog");
      expect(confirm).toHaveTextContent("高橋 みゆき さんが 山と印刷 のオーナーになります");
      await user.click(within(confirm).getByRole("button", { name: "譲渡する" }));

      await waitFor(() => expect(api.paths()).toContain("POST /api/v1/workspaces/ws-1/ownership-transfer"));
      // 譲渡した自分は管理者になり、譲渡の項目が消えて、退出できるようになる
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "退出する" }));
      expect(screen.getByRole("dialog")).toHaveTextContent("山と印刷 から退出します");
    });

    it("leaves the workspace and forgets where the user was", async () => {
      const user = userEvent.setup();
      rememberLocation("ws-1", "r-1");
      const { api } = renderAdmin(
        <SettingsSection />,
        { [`DELETE /api/v1/workspaces/ws-1/members/${naoki.id}`]: () => new Response(null, { status: 204 }) },
        "member",
      );

      await user.click(await screen.findByRole("button", { name: "退出する" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "退出する" }));

      await waitFor(() => expect(api.paths()).toContain(`DELETE /api/v1/workspaces/ws-1/members/${naoki.id}`));
      await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/"));
      expect(lastWorkspaceId()).toBeUndefined();
    });

    it("shows a member that they cannot change the settings", async () => {
      renderAdmin(<SettingsSection />, {}, "member");

      expect(await screen.findByLabelText("ワークスペース名")).toBeDisabled();
      expect(screen.getByText("ワークスペースの設定を変更できるのは管理者とオーナーだけです。")).toBeInTheDocument();
    });
  });

  describe("invites", () => {
    beforeEach(() => {
      nav.pathname = "/w/ws-1/admin/invites";
    });

    it("creates a link, shows it once, and does not keep it in the list", async () => {
      const user = userEvent.setup();
      const { api } = renderAdmin(<InvitesSection />, {
        "POST /api/v1/workspaces/ws-1/invites": () => json(201, { ...invite("i-2"), code: "7Qv2xkR8mA" }),
      });

      await user.click(await screen.findByRole("button", { name: "招待リンクを作成" }));
      await user.click(screen.getByRole("radio", { name: "5 回" }));
      await user.click(screen.getByRole("radio", { name: "1日" }));
      await user.click(screen.getByRole("button", { name: "作成する" }));

      await waitFor(() =>
        expect(api.calls.at(-1)?.init.body).toBe(JSON.stringify({ max_uses: 5, expires_in_seconds: 86400 })),
      );
      const dialog = within(await screen.findByRole("dialog"));
      expect(dialog.getByText(`${window.location.origin}/j/7Qv2xkR8mA`)).toBeInTheDocument();
      expect(dialog.getByText("5 回 · 1日後に失効 · 山と印刷")).toBeInTheDocument();

      await user.click(dialog.getByRole("button", { name: "閉じる" }));
      expect(screen.queryByText(/7Qv2xkR8mA/)).not.toBeInTheDocument();
      expect(screen.getAllByText("hibari.app/j/•••••••")).toHaveLength(2);
    });

    it("revokes a link", async () => {
      const user = userEvent.setup();
      const { api } = renderAdmin(<InvitesSection />, {
        "DELETE /api/v1/workspaces/ws-1/invites/i-1": () => new Response(null, { status: 204 }),
      });

      await user.click(await screen.findByRole("button", { name: "取り消す" }));

      await waitFor(() => expect(api.paths()).toContain("DELETE /api/v1/workspaces/ws-1/invites/i-1"));
      expect(await screen.findByText("取り消し済み")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "取り消す" })).not.toBeInTheDocument();
    });

    it("tells a member why they cannot create a link", async () => {
      renderAdmin(<InvitesSection />, {}, "member");

      expect(await screen.findByText("管理者だけが招待リンクを作成できます。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "招待リンクを作成" })).toBeDisabled();
      // 他人が作った招待は取り消せない（ADR 0011）
      expect(screen.queryByRole("button", { name: "取り消す" })).not.toBeInTheDocument();
    });
  });
});
