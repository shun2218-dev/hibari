import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InviteAccept } from "./invite-accept";

const preview = {
  workspace: { id: "w1", name: "山と印刷", memberCount: 6, publicRoomCount: 8 },
  inviter: { id: "u1", name: "田中 美咲" },
};

describe("InviteAccept", () => {
  it("previews a valid invite and accepts it", async () => {
    const onAccept = vi.fn();
    render(<InviteAccept state={{ status: "valid", preview }} onAccept={onAccept} homeHref="/" />);

    expect(screen.getByRole("heading", { name: "山と印刷" })).toBeInTheDocument();
    expect(screen.getByText("6人のメンバー · 8 チャンネル")).toBeInTheDocument();
    expect(screen.getByText("田中 美咲")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "参加する" }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("prevents double submission while accepting", () => {
    render(<InviteAccept state={{ status: "valid", preview, accepting: true }} homeHref="/" />);

    expect(screen.getByRole("button", { name: "参加する" })).toBeDisabled();
  });

  it("opens the workspace when already a member", async () => {
    const onOpen = vi.fn();
    render(<InviteAccept state={{ status: "already_member", preview }} onOpen={onOpen} homeHref="/" />);

    expect(screen.getByRole("heading", { name: "すでに参加しています" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "参加する" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "開く" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it.each([
    ["invalid", "この招待リンクは使えません"],
    ["expired", "リンクの有効期限が切れています"],
    ["maxed", "このリンクは使用上限に達しました"],
  ] as const)("explains an %s invite without workspace details", (status, heading) => {
    render(<InviteAccept state={{ status }} homeHref="/home" />);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByText("山と印刷")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "参加する" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ホームに戻る" })).toHaveAttribute("href", "/home");
  });
});
