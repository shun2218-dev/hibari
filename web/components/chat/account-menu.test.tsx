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

  // ADR 0049: ステータスと手動の離席の入口はここだけ
  it("ステータスが無ければ「ステータスを設定」を出す", async () => {
    const onOpenStatus = vi.fn();
    render(<AccountMenu user={{ id: "u1", name: "あなた", handle: "you" }} onOpenStatus={onOpenStatus} />);

    await userEvent.click(screen.getByRole("button", { name: "ステータスを設定" }));

    expect(onOpenStatus).toHaveBeenCalledOnce();
  });

  it("設定済みのステータスは、そのまま押して変えられる", async () => {
    const onOpenStatus = vi.fn();
    render(
      <AccountMenu
        user={{ id: "u1", name: "あなた", handle: "you", status: { emoji: "🍵", text: "休憩中" } }}
        onOpenStatus={onOpenStatus}
      />,
    );

    // 絵文字は aria-hidden なので、読み上げでは文言だけが名前になる
    await userEvent.click(screen.getByRole("button", { name: "休憩中" }));

    expect(onOpenStatus).toHaveBeenCalledOnce();
  });

  it("離席の切り替えは、いまの状態で文言が変わる", async () => {
    const onToggleAway = vi.fn();
    const { rerender } = render(
      <AccountMenu user={{ id: "u1", name: "あなた", handle: "you" }} onToggleAway={onToggleAway} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "離席中にする" }));

    rerender(<AccountMenu user={{ id: "u1", name: "あなた", handle: "you" }} away onToggleAway={onToggleAway} />);
    await userEvent.click(screen.getByRole("button", { name: "離席を解除する" }));

    expect(onToggleAway).toHaveBeenCalledTimes(2);
  });
});
