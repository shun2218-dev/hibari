import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProfileHoverCard } from "./profile-card";
import type { ProfileView } from "./types";

const naoki: ProfileView = {
  kind: "member",
  user: { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹", handle: "naoki", status: { emoji: "📅", text: "会議中" } },
  presence: "online",
  role: "owner",
  email: { state: "ready", value: "naoki@example.com" },
  isSelf: false,
  manage: { grantableRoles: ["admin", "member"], canRemove: true },
};

describe("ProfileHoverCard（ADR 0050 決定 6 の追記）", () => {
  it("要約と「DM を送る」だけを出す。email と管理の入口は出さない", async () => {
    const onSendDm = vi.fn();
    render(<ProfileHoverCard profile={naoki} onSendDm={onSendDm} />);

    expect(screen.getByText("佐藤 直樹")).toBeInTheDocument();
    expect(screen.getByText("@naoki")).toBeInTheDocument();
    expect(screen.getByText("会議中")).toBeInTheDocument();
    expect(screen.queryByText("naoki@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "その他の操作" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "DM を送る" }));
    expect(onSendDm).toHaveBeenCalledOnce();
  });

  it("「DM を送る」は応答を待つ間、押せない", () => {
    render(<ProfileHoverCard profile={naoki} dmPending />);

    expect(screen.getByRole("button", { name: "DM を送る" })).toBeDisabled();
  });

  it("自分のカードと外された人のカードには操作を置かない", () => {
    const { rerender } = render(<ProfileHoverCard profile={{ ...naoki, isSelf: true }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<ProfileHoverCard profile={{ kind: "former", user: { id: "01J8ZH5K00000000000000000H", name: "森田 圭", handle: "kei" } }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("このワークスペースのメンバーではありません")).toBeInTheDocument();
  });
});
