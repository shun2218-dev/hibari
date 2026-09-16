import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountMenu } from "./account-menu";

describe("AccountMenu", () => {
  it("leads to the workspace settings, the settings and logout", async () => {
    const onOpenWorkspaceSettings = vi.fn();
    const onOpenSettings = vi.fn();
    const onLogout = vi.fn();
    render(
      <AccountMenu
        user={{ id: "u1", name: "あなた", handle: "you" }}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onOpenSettings={onOpenSettings}
        onLogout={onLogout}
      />,
    );

    expect(screen.getByText("@you")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ワークスペース設定" }));
    await userEvent.click(screen.getByRole("button", { name: "設定" }));
    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));

    expect(onOpenWorkspaceSettings).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
