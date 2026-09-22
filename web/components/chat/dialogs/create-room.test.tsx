import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateRoomDialog } from "./create-room";

describe("CreateRoomDialog", () => {
  it("says that the visibility cannot be changed later", () => {
    render(<CreateRoomDialog open name="" kind="public" />);

    expect(screen.getByRole("dialog", { name: "チャンネルを作成" })).toHaveAccessibleDescription(
      "あとから名前は変更できます。公開範囲は作成後に変えられません。",
    );
  });

  it("requires a name", async () => {
    const onCreate = vi.fn();
    const { rerender } = render(<CreateRoomDialog open name="   " kind="public" onCreate={onCreate} />);
    expect(screen.getByRole("button", { name: "作成する" })).toBeDisabled();

    rerender(<CreateRoomDialog open name="デザインレビュー" kind="public" onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: "作成する" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("switches the visibility", async () => {
    const onKindChange = vi.fn();
    render(<CreateRoomDialog open name="雑談" kind="public" onKindChange={onKindChange} />);

    expect(screen.getByRole("radio", { name: /^公開/ })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: /非公開/ }));
    expect(onKindChange).toHaveBeenCalledWith("private");
  });
});
