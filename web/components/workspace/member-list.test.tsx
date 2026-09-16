import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MemberList } from "./member-list";
import type { MemberRowView } from "./types";

const members: MemberRowView[] = [
  { id: "u1", name: "あなた", handle: "you", online: true, role: "admin", isSelf: true, manage: { kind: "locked", reason: "自分と同じか上のロールのメンバーは変更できません。" } },
  { id: "u2", name: "鈴木 涼", handle: "ryo", online: false, role: "member", isSelf: false, manage: { kind: "menu", grantableRoles: ["admin", "member"] } },
];

describe("MemberList", () => {
  it("lists members with role, handle and presence", () => {
    render(<MemberList members={members} />);

    expect(screen.getByRole("heading", { name: "2人のメンバー" })).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("あなた", { selector: "span.truncate" })).toBeInTheDocument();
    expect(within(rows[0]).getByText("管理者")).toBeInTheDocument();
    expect(within(rows[0]).getByText("オンライン")).toBeInTheDocument();
    expect(within(rows[1]).getByText("@ryo")).toBeInTheDocument();
    expect(within(rows[1]).getByText("オフライン")).toBeInTheDocument();
  });

  it("shows a menu only for members the viewer can manage", async () => {
    const onOpenMenu = vi.fn();
    render(<MemberList members={members} onOpenMenu={onOpenMenu} />);

    await userEvent.click(screen.getByRole("button", { name: "鈴木 涼 のロールを変更" }));
    await userEvent.click(screen.getByRole("button", { name: "あなた を管理できない理由" }));

    expect(onOpenMenu).toHaveBeenNthCalledWith(1, { userId: "u2", kind: "roles" });
    expect(onOpenMenu).toHaveBeenNthCalledWith(2, { userId: "u1", kind: "locked" });
    expect(screen.queryByRole("button", { name: "あなた のロールを変更" })).not.toBeInTheDocument();
  });

  it("lists grantable roles and marks the current one", async () => {
    const onChangeRole = vi.fn();
    render(<MemberList members={members} openMenu={{ userId: "u2", kind: "roles" }} onChangeRole={onChangeRole} />);

    const picker = screen.getByRole("dialog", { name: "付与できるロール" });
    expect(within(picker).getByRole("button", { name: "メンバー" })).toHaveAttribute("aria-pressed", "true");
    expect(within(picker).getByRole("button", { name: "管理者" })).toHaveAttribute("aria-pressed", "false");
    expect(within(picker).getByText("オーナーは譲渡でのみ移ります。")).toBeInTheDocument();

    await userEvent.click(within(picker).getByRole("button", { name: "管理者" }));
    expect(onChangeRole).toHaveBeenCalledWith("u2", "admin");
  });

  it("explains why a member cannot be managed", async () => {
    const onCloseMenu = vi.fn();
    render(<MemberList members={members} openMenu={{ userId: "u1", kind: "locked" }} onCloseMenu={onCloseMenu} />);

    const reason = screen.getByRole("dialog", { name: "管理できない理由" });
    expect(reason).toHaveTextContent("自分と同じか上のロールのメンバーは変更できません。");

    await userEvent.click(within(reason).getByRole("button", { name: "閉じる" }));
    expect(onCloseMenu).toHaveBeenCalledOnce();
  });
});
