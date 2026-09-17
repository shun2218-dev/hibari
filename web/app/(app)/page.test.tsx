import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rememberLocation } from "@/lib/chat/last-location";
import { workspace } from "@/test/chat-data";
import { json } from "@/test/fake-api";
import { renderWithChat } from "@/test/render-with-chat";

import HomePage from "./page";

const nav = vi.hoisted(() => ({ router: { replace: vi.fn(), push: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));

describe("HomePage", () => {
  beforeEach(() => {
    nav.router.replace.mockReset();
    nav.router.push.mockReset();
    window.localStorage.clear();
  });

  const two = { workspaces: [workspace("ws-1", "hibari 開発"), workspace("ws-2", "個人メモ")] };

  it("goes to the first workspace when nothing is remembered", async () => {
    renderWithChat(<HomePage />, { "GET /api/v1/workspaces": () => json(200, two) });

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1"));
  });

  it("goes back to the last opened workspace", async () => {
    rememberLocation("ws-2", "room-9");

    renderWithChat(<HomePage />, { "GET /api/v1/workspaces": () => json(200, two) });

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-2"));
  });

  it("ignores a remembered workspace the user no longer belongs to", async () => {
    rememberLocation("ws-gone", undefined);

    renderWithChat(<HomePage />, { "GET /api/v1/workspaces": () => json(200, two) });

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-1"));
  });

  it("offers to create a workspace when there is none, then opens it", async () => {
    const { api } = renderWithChat(<HomePage />, {
      "GET /api/v1/workspaces": () => json(200, { workspaces: [] }),
      "POST /api/v1/workspaces": () => json(201, workspace("ws-new", "山と印刷", { my_role: "owner" })),
    });

    await userEvent.click(await screen.findByRole("button", { name: "ワークスペースを作成" }));
    const dialog = screen.getByRole("dialog", { name: "ワークスペースを作成" });
    expect(screen.getByRole("button", { name: "作成" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("ワークスペース名"), "  山と印刷 ");
    await userEvent.click(screen.getByRole("button", { name: "作成" }));

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/w/ws-new"));
    expect(JSON.parse(api.calls.at(-1)!.init.body as string)).toEqual({ name: "山と印刷" });
    expect(dialog).not.toBeInTheDocument();
    // 一覧が 1 件になって移るので、作成の側からは移らない（2 回移らない）
    expect(nav.router.push).not.toHaveBeenCalled();
  });
});
