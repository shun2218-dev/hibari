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

describe("ProfileHoverCard のハドル中（ADR 0067 決定 4）", () => {
  it("ステータスを設定していれば、名前の横はステータスのまま、カードに「ハドルミーティング中」の行を足す", () => {
    render(<ProfileHoverCard profile={{ ...naoki, inHuddle: true }} />);

    expect(screen.getByText("会議中")).toBeInTheDocument();
    expect(screen.getByText("ハドルミーティング中")).toBeInTheDocument();
    // 📅 は名前の横とステータスの行、🎧 は「ハドルミーティング中」の行だけ
    expect(screen.getAllByText("📅")).toHaveLength(2);
    expect(screen.getAllByText("🎧")).toHaveLength(1);
  });

  it("ステータスがなければ、名前の横に 🎧 を出す", () => {
    const { user } = naoki as Extract<typeof naoki, { kind: "member" }>;
    render(<ProfileHoverCard profile={{ ...naoki, user: { ...user, status: undefined }, inHuddle: true }} />);

    expect(screen.getByText("ハドルミーティング中")).toBeInTheDocument();
    // 名前の横と「ハドルミーティング中」の行の 2 か所
    expect(screen.getAllByText("🎧")).toHaveLength(2);
  });

  it("ハドル中でなければ出さない", () => {
    render(<ProfileHoverCard profile={naoki} />);

    expect(screen.queryByText("ハドルミーティング中")).not.toBeInTheDocument();
  });
});
