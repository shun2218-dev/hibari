import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  describe("scrolling", () => {
    const ROW = 100;
    const VIEWPORT = 250;

    /** jsdom にはレイアウトがないので、行の高さを固定した寸法を与える。 */
    function fakeLayout() {
      const scroller = () => screen.getByRole("list", { name: "メッセージ" }).parentElement!;
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this === scroller() ? this.querySelectorAll("ol > li").length * ROW : 0;
      });
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this === scroller() ? VIEWPORT : 0;
      });
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
        const parent = this.parentElement;
        return parent?.tagName === "OL" ? Array.from(parent.children).indexOf(this) * ROW : 0;
      });
      return scroller;
    }

    afterEach(() => vi.restoreAllMocks());

    it("opens at the newest message", () => {
      const scroller = fakeLayout();
      render(<Timeline items={[msg("a", "1"), msg("b", "2"), msg("c", "3"), msg("d", "4")]} />);

      expect(scroller().scrollTop).toBe(4 * ROW);
    });

    it("keeps the message the reader was looking at in place when older messages are prepended", () => {
      const scroller = fakeLayout();
      const items = [msg("c", "3"), msg("d", "4"), msg("e", "5"), msg("f", "6")];
      const { rerender } = render(<Timeline items={items} />);
      scroller().scrollTop = 50;
      fireEvent.scroll(scroller());

      rerender(<Timeline items={[msg("a", "1"), msg("b", "2"), ...items]} />);

      // 先頭だった c は 2 行ぶん下に移ったので、同じだけ下にずらす
      expect(scroller().scrollTop).toBe(50 + 2 * ROW);
    });

    it("follows new messages only while at the bottom", () => {
      const scroller = fakeLayout();
      const items = [msg("a", "1"), msg("b", "2"), msg("c", "3")];
      const { rerender } = render(<Timeline items={items} />);
      expect(scroller().scrollTop).toBe(3 * ROW);
      scroller().scrollTop = 3 * ROW - VIEWPORT;
      fireEvent.scroll(scroller());

      rerender(<Timeline items={[...items, msg("d", "4")]} />);
      expect(scroller().scrollTop).toBe(4 * ROW);

      scroller().scrollTop = 0;
      fireEvent.scroll(scroller());
      rerender(<Timeline items={[...items, msg("d", "4"), msg("e", "5")]} />);
      expect(scroller().scrollTop).toBe(0);
    });

    it("asks for older messages near the top, or when everything fits on screen", () => {
      const scroller = fakeLayout();
      const onReachStart = vi.fn();
      const { rerender } = render(<Timeline items={[msg("a", "1")]} onReachStart={onReachStart} />);
      expect(onReachStart).toHaveBeenCalledOnce();

      const many = Array.from({ length: 20 }, (_, i) => msg(`m${i}`, String(i)));
      rerender(<Timeline items={many} onReachStart={onReachStart} />);
      expect(onReachStart).toHaveBeenCalledOnce();

      scroller().scrollTop = 300;
      fireEvent.scroll(scroller());
      expect(onReachStart).toHaveBeenCalledTimes(2);
    });
  });
});
