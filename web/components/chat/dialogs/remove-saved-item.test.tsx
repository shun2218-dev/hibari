import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RemoveSavedItemDialog } from "./remove-saved-item";

describe("RemoveSavedItemDialog（ADR 0054 決定 8）", () => {
  it("読めない理由を区別せずに伝え、「外す」で確定する", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<RemoveSavedItemDialog open onConfirm={onConfirm} onCancel={onCancel} />);

    expect(screen.getByRole("dialog", { name: "「後で」から外しますか？" })).toHaveTextContent("削除されたか、読めなくなりました");
    await userEvent.click(screen.getByRole("button", { name: "外す" }));
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
