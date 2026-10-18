import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceSettings } from "./workspace-settings";

describe("WorkspaceSettings", () => {
  it.each(["owner", "admin"] as const)("lets the %s edit the name and invite policy", async (role) => {
    const onInvitePolicyChange = vi.fn();
    render(<WorkspaceSettings role={role} name="山と印刷" invitePolicy="admins_only" onInvitePolicyChange={onInvitePolicyChange} />);

    expect(screen.getByLabelText("ワークスペース名")).toBeEnabled();
    expect(screen.queryByText("ワークスペースの設定を変更できるのは管理者とオーナーだけです。")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /全メンバー/ }));
    expect(onInvitePolicyChange).toHaveBeenCalledWith("all_members");
  });

  it("shows settings read-only to a member and says why", () => {
    render(<WorkspaceSettings role="member" name="山と印刷" invitePolicy="admins_only" />);

    expect(screen.getByText("ワークスペースの設定を変更できるのは管理者とオーナーだけです。")).toBeInTheDocument();
    expect(screen.getByLabelText("ワークスペース名")).toBeDisabled();
    expect(screen.getByRole("radio", { name: /管理者のみ/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /全メンバー/ })).toBeDisabled();
  });

  it("offers ownership transfer only to the owner", () => {
    const { rerender } = render(<WorkspaceSettings role="owner" name="山と印刷" invitePolicy="admins_only" />);
    expect(screen.getByRole("button", { name: "オーナーを譲渡" })).toBeInTheDocument();
    expect(screen.getByText(/退出するには、先に他のメンバーにオーナーを譲渡してください/)).toBeInTheDocument();

    rerender(<WorkspaceSettings role="admin" name="山と印刷" invitePolicy="admins_only" />);
    expect(screen.queryByRole("button", { name: "オーナーを譲渡" })).not.toBeInTheDocument();
  });

  it("lets anyone press leave (the owner is then asked to transfer first)", async () => {
    const onLeave = vi.fn();
    render(<WorkspaceSettings role="owner" name="山と印刷" invitePolicy="admins_only" onLeave={onLeave} />);

    await userEvent.click(screen.getByRole("button", { name: "退出する" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
