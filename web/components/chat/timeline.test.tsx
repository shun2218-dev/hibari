import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Timeline } from "./timeline";
import type { MessageView, TimelineItem } from "./types";

function msg(key: string, body: string, overrides: Partial<MessageView> = {}): TimelineItem {
  return {
    type: "message",
    message: {
      key,
      sender: { id: "u1", name: "あなた" },
      timeLabel: "10:00",
      body,
      status: "sent",
      deleted: false,
      edited: false,
      attachments: [],
      grouped: false,
      ...overrides,
    },
  };
}

describe("Timeline", () => {
  it("keeps the given order (sorting by seq belongs to the data layer)", () => {
    render(<Timeline items={[msg("b", "二番目"), msg("a", "一番目")]} />);

    expect(screen.getAllByRole("article").map((a) => a.textContent)).toEqual([
      expect.stringContaining("二番目"),
      expect.stringContaining("一番目"),
    ]);
  });

  it("renders date and unread dividers", async () => {
    const onMarkAllRead = vi.fn();
    render(
      <Timeline
        onMarkAllRead={onMarkAllRead}
        items={[{ type: "date", key: "d", label: "2026年9月13日" }, msg("a", "既読"), { type: "unread", key: "u" }, msg("b", "未読")]}
      />,
    );

    expect(screen.getByText("2026年9月13日")).toBeInTheDocument();
    expect(screen.getByText("ここから未読")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "すべて既読にする" }));
    expect(onMarkAllRead).toHaveBeenCalledOnce();
  });

  it("passes the message key to per-message actions", async () => {
    const onRetry = vi.fn();
    render(<Timeline items={[msg("client-1", "失敗", { status: "failed" })]} onRetry={onRetry} />);

    await userEvent.click(screen.getByRole("button", { name: "再送する" }));

    expect(onRetry).toHaveBeenCalledWith("client-1");
  });
});
