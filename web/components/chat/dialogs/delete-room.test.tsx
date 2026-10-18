import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteRoomDialog } from "./delete-room";

describe("DeleteRoomDialog（ADR 0059）", () => {
  it("「はい、完全に削除します」にチェックを入れるまで押せない", async () => {
    const onConfirm = vi.fn();
    render(<DeleteRoomDialog open name="雑談" onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog", { name: "チャンネルを削除しますか？" })).toHaveAccessibleDescription(/元に戻せません/);
    const button = screen.getByRole("button", { name: "チャンネルを削除する" });
    expect(button).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: "はい、完全に削除します" }));
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("開き直すと、チェックは外れた状態から始まる", async () => {
    const { rerender } = render(<DeleteRoomDialog open name="雑談" />);
    await userEvent.click(screen.getByRole("checkbox", { name: "はい、完全に削除します" }));

    rerender(<DeleteRoomDialog open={false} name="雑談" />);
    rerender(<DeleteRoomDialog open name="雑談" />);
    expect(screen.getByRole("checkbox", { name: "はい、完全に削除します" })).not.toBeChecked();
  });
});
