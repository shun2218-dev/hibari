import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteMessageDialog } from "./delete-message";

describe("DeleteMessageDialog", () => {
  it("quotes the message being deleted", async () => {
    const onConfirm = vi.fn();
    render(<DeleteMessageDialog open body="了解です。今日の夕方までに一覧を更新して、また共有します。" onConfirm={onConfirm} />);

    expect(screen.getByText("了解です。今日の夕方までに一覧を更新して、また共有します。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
