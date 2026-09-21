import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RoomHeader } from "./room-header";

describe("RoomHeader のピン留め（ADR 0054）", () => {
  it("件数を添えたボタンを出し、押すと開け閉てを呼ぶ", async () => {
    const onToggle = vi.fn();
    render(<RoomHeader kind="public" name="デザインレビュー" memberCount={4} pins={{ count: 3, open: false, onToggle }} />);

    const button = screen.getByRole("button", { name: "ピン留め 3 件" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("0 件でも出す（開けばピン留めのしかたが分かる）", () => {
    render(<RoomHeader kind="public" name="デザインレビュー" memberCount={4} pins={{ count: 0, open: true }} />);

    expect(screen.getByRole("button", { name: "ピン留め 0 件" })).toHaveAttribute("aria-expanded", "true");
  });

  it("渡さなければ出さない", () => {
    render(<RoomHeader kind="public" name="デザインレビュー" memberCount={4} />);

    expect(screen.queryByRole("button", { name: /ピン留め/ })).not.toBeInTheDocument();
  });
});
