import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmMentionAllDialog } from "./confirm-mention-all";

describe("ConfirmMentionAllDialog", () => {
  it("@channel はメンバーの人数を出して、送信で確定する（ADR 0043）", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmMentionAllDialog open kind="channel" memberCount={12} onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog", { name: "@channel を送りますか？" })).toBeInTheDocument();
    expect(screen.getByText("このチャンネルのメンバー 12 人に知らせが飛びます。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "送信する" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("@here はオンラインの人数を出して、キャンセルで閉じる", async () => {
    const onCancel = vi.fn();
    render(<ConfirmMentionAllDialog open kind="here" memberCount={4} onCancel={onCancel} />);

    expect(screen.getByText("いまオンラインの 4 人に知らせが飛びます。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("閉じているときは何も出さない", () => {
    render(<ConfirmMentionAllDialog open={false} kind="channel" memberCount={12} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
