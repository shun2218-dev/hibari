import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LeaveRoomDialog } from "./leave-room";

describe("LeaveRoomDialog", () => {
  it.each([
    { kind: "public" as const, consequence: "退出したあとも読めます" },
    { kind: "private" as const, consequence: "退出すると読めなくなります" },
  ])("names the room and says whether it stays readable ($kind)", async ({ kind, consequence }) => {
    const onConfirm = vi.fn();
    render(<LeaveRoomDialog open kind={kind} name="リリース準備" onConfirm={onConfirm} />);

    expect(screen.getByText(new RegExp(`リリース準備 から退出します。.*${consequence}`))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "退出する" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cannot be confirmed twice while leaving", () => {
    render(<LeaveRoomDialog open kind="public" name="雑談" pending />);

    expect(screen.getByRole("button", { name: "退出する" })).toBeDisabled();
  });
});
