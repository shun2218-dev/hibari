import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { KickMemberDialog, LeaveBlockedDialog, TransferOwnershipPickDialog } from "./member-dialogs";

describe("member dialogs", () => {
  it("confirms a kick naming the member", async () => {
    const onConfirm = vi.fn();
    render(<KickMemberDialog open memberName="鈴木 涼" onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog", { name: "メンバーを削除しますか？" })).toHaveAccessibleDescription(
      expect.stringContaining("鈴木 涼 さんをこのワークスペースから削除します。"),
    );
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("disables the confirmation while pending", () => {
    render(<KickMemberDialog open memberName="鈴木 涼" pending />);

    expect(screen.getByRole("button", { name: "削除する" })).toBeDisabled();
  });

  it("requires a transfer target before continuing", async () => {
    const onSelect = vi.fn();
    const candidates = [
      { id: "u2", name: "佐藤 直樹", handle: "naoki", role: "admin" as const },
      { id: "u3", name: "鈴木 涼", handle: "ryo", role: "member" as const },
    ];
    const { rerender } = render(<TransferOwnershipPickDialog open candidates={candidates} onSelect={onSelect} />);

    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /鈴木 涼/ }));
    expect(onSelect).toHaveBeenCalledWith("u3");

    rerender(<TransferOwnershipPickDialog open candidates={candidates} selectedId="u3" />);
    expect(screen.getByRole("radio", { name: /鈴木 涼/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "次へ" })).toBeEnabled();
  });

  it("leads a blocked owner to the transfer", async () => {
    const onTransfer = vi.fn();
    render(<LeaveBlockedDialog open onTransfer={onTransfer} />);

    await userEvent.click(screen.getByRole("button", { name: "オーナーを譲渡" }));
    expect(onTransfer).toHaveBeenCalledOnce();
  });
});
