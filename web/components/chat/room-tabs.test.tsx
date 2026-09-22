import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RoomTabs } from "./room-tabs";

describe("RoomTabs（ADR 0054）", () => {
  it("「メッセージ」と「ピン」を出し、押したタブで onChange を呼ぶ", async () => {
    const onChange = vi.fn();
    render(<RoomTabs value="messages" onChange={onChange} />);

    expect(screen.getByRole("tab", { name: "メッセージ" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "ピン" }));
    expect(onChange).toHaveBeenCalledWith("pins");
  });
});
