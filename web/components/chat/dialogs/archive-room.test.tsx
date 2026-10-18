import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ArchiveRoomDialog } from "./archive-room";

describe("ArchiveRoomDialog（ADR 0059）", () => {
  it("名前と、戻せることを伝えて確定する", async () => {
    const onConfirm = vi.fn();
    render(<ArchiveRoomDialog open name="雑談" onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog", { name: "チャンネルをアーカイブしますか？" })).toHaveAccessibleDescription(/雑談 をアーカイブします。.*あとで復元できます。/);
    await userEvent.click(screen.getByRole("button", { name: "アーカイブする" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
