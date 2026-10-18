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

  it("shows a system log as a quiet line, not as a message", () => {
    render(
      <Timeline
        items={[
          msg("a", "おはよう"),
          { type: "system", key: "s1", text: "佐藤 直樹 がチャンネルに参加しました", timeLabel: "10:05" },
        ]}
      />,
    );

    // ログは article（メッセージ）にしない。アバターも名前も出さない
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("佐藤 直樹 がチャンネルに参加しました")).toBeInTheDocument();
    expect(screen.getByText("10:05")).toBeInTheDocument();
  });

  it("ハドルのメッセージを並べ、「参加」でそのメッセージの key を渡す（ADR 0066 決定 12）", async () => {
    const onJoinHuddle = vi.fn();
    render(
      <Timeline
        items={[
          msg("a", "おはよう"),
          {
            type: "huddle",
            huddle: {
              key: "h1",
              starter: { id: "u2", name: "佐藤 直樹" },
              timeLabel: "11:20",
              state: "active",
              participants: [{ id: "u2", name: "佐藤 直樹" }],
            },
          },
        ]}
        onJoinHuddle={onJoinHuddle}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "参加" }));
    expect(onJoinHuddle).toHaveBeenCalledWith("h1");
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

    it("jumps to the newest message when asked, even while reading older ones", () => {
      const scroller = fakeLayout();
      const items = [msg("a", "1"), msg("b", "2"), msg("c", "3")];
      const { rerender } = render(<Timeline items={items} scrollToLatestKey={0} />);
      scroller().scrollTop = 0;
      fireEvent.scroll(scroller());

      rerender(<Timeline items={[...items, msg("d", "4", { status: "pending" })]} scrollToLatestKey={1} />);

      expect(scroller().scrollTop).toBe(4 * ROW);
    });

    it("飛び先を画面の中ほどに置く（ADR 0042）", () => {
      const scroller = fakeLayout();
      const items = [msg("a", "1"), msg("b", "2"), msg("c", "3"), msg("d", "4")];
      const { rerender } = render(<Timeline items={items} />);
      expect(scroller().scrollTop).toBe(4 * ROW);

      rerender(<Timeline items={items} scrollToKey="c" />);

      // c の上端（200）から、画面の半分ぶん上に戻したところ
      expect(scroller().scrollTop).toBe(2 * ROW - VIEWPORT / 2);

      // 「ここから未読」の線は、そこから下が全部未読なので上端に合わせる
      rerender(
        <Timeline items={[...items, { type: "unread", key: "unread" }]} scrollToKey="unread" scrollToAlign="start" />,
      );
      expect(scroller().scrollTop).toBe(4 * ROW);
    });

    it("いちばん下の近くまで来たら、新しい方の読み足しを頼む（ADR 0042）", () => {
      const scroller = fakeLayout();
      const onReachEnd = vi.fn();
      render(<Timeline items={Array.from({ length: 10 }, (_, i) => msg(`m${i}`, String(i)))} onReachEnd={onReachEnd} />);
      onReachEnd.mockClear();

      scroller().scrollTop = 0;
      fireEvent.scroll(scroller());
      expect(onReachEnd).not.toHaveBeenCalled();

      scroller().scrollTop = 10 * ROW - VIEWPORT;
      fireEvent.scroll(scroller());
      expect(onReachEnd).toHaveBeenCalled();
    });

    it("reports when the newest message comes into or goes out of view", () => {
      const scroller = fakeLayout();
      const onAtBottomChange = vi.fn();
      const items = Array.from({ length: 5 }, (_, i) => msg(`m${i}`, String(i)));
      const { rerender } = render(<Timeline items={items} onAtBottomChange={onAtBottomChange} />);
      expect(onAtBottomChange.mock.calls).toEqual([[true]]);

      scroller().scrollTop = 0;
      fireEvent.scroll(scroller());
      fireEvent.scroll(scroller());
      expect(onAtBottomChange.mock.calls).toEqual([[true], [false]]);

      // 上を読んでいる間に届いても、下には付いていかないので見えていないまま
      rerender(<Timeline items={[...items, msg("m5", "5")]} onAtBottomChange={onAtBottomChange} />);
      expect(onAtBottomChange).toHaveBeenCalledTimes(2);

      scroller().scrollTop = 6 * ROW - VIEWPORT;
      fireEvent.scroll(scroller());
      expect(onAtBottomChange.mock.calls.at(-1)).toEqual([true]);
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

  describe("飛び先の強調（ADR 0042）", () => {
    it("強調しているときに押したら知らせる（時間を待たずに消せるように）", async () => {
      const onClearHighlight = vi.fn();
      const { rerender } = render(
        <Timeline items={[msg("a", "1")]} highlightedKey="a" onClearHighlight={onClearHighlight} />,
      );

      await userEvent.click(screen.getByRole("article"));
      expect(onClearHighlight).toHaveBeenCalled();

      // 強調していないときは知らせない
      onClearHighlight.mockClear();
      rerender(<Timeline items={[msg("a", "1")]} onClearHighlight={onClearHighlight} />);
      await userEvent.click(screen.getByRole("article"));
      expect(onClearHighlight).not.toHaveBeenCalled();
    });
  });
});

describe("Timeline の添付ファイル（ADR 0045）", () => {
  const image = { kind: "image", id: "a1", fileName: "改訂 01.png", url: "https://example/a1" } as const;
  const file = { kind: "file", id: "a2", fileName: "type-scale.pdf", sizeLabel: "248 KB" } as const;

  it("画像を押したら、どのメッセージのどの添付かを渡して呼ぶ", async () => {
    const onOpenImage = vi.fn();
    render(<Timeline items={[msg("a", "写真です", { attachments: [image] })]} onOpenImage={onOpenImage} />);

    await userEvent.click(screen.getByRole("button", { name: "改訂 01.png を拡大表示" }));

    expect(onOpenImage).toHaveBeenCalledWith("a", "a1");
  });

  it("添付の「…」は、開いているメッセージの添付にだけ出す", async () => {
    const onDeleteAttachment = vi.fn();
    render(
      <Timeline
        items={[msg("a", "資料です", { attachments: [file] }), msg("b", "こちらも", { attachments: [file] })]}
        actionsFor={() => ({ canEdit: false, canDelete: true })}
        onDeleteAttachment={onDeleteAttachment}
        openAttachmentMenu={{ key: "b", attachmentId: "a2" }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "ファイルを削除" }));

    expect(onDeleteAttachment).toHaveBeenCalledWith("b", "a2");
  });
});

describe("Timeline の外部のリンクのプレビュー（ADR 0065）", () => {
  const preview = { id: "p1", url: "https://example.com/1", siteName: "Example", title: "記事", hasIcon: false };

  it("消せるのは編集できる（本人の）メッセージだけで、どのメッセージのどのカードかを渡して呼ぶ", async () => {
    const onRemoveLinkPreview = vi.fn();
    render(
      <Timeline
        items={[msg("a", "ほかの人", { linkPreviews: [preview] }), msg("b", "自分", { linkPreviews: [{ ...preview, id: "p2" }] })]}
        actionsFor={(key) => ({ canEdit: key === "b", canDelete: key === "b" })}
        onRemoveLinkPreview={onRemoveLinkPreview}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "プレビューを削除" });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);

    expect(onRemoveLinkPreview).toHaveBeenCalledWith("b", "p2");
  });

  it("削除したメッセージにはカードを出さない", () => {
    render(<Timeline items={[msg("a", "", { deleted: true, linkPreviews: [preview] })]} />);

    expect(screen.queryByRole("article", { name: "記事 のプレビュー" })).not.toBeInTheDocument();
  });
});

describe("Timeline のピン留めと「後で」（ADR 0054）", () => {
  it("key ごとにピン留めと「後で」の操作を渡す", async () => {
    const pin = vi.fn();
    render(
      <Timeline
        items={[msg("a", "一番目"), msg("b", "二番目")]}
        pinFor={(key) => (key === "b" ? { label: "チャンネルへピン留めする", onClick: () => pin(key) } : undefined)}
        saveFor={(key) => (key === "a" ? { saved: true, onClick: () => {} } : undefined)}
        openMenuKey="b"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "チャンネルへピン留めする" }));
    expect(pin).toHaveBeenCalledWith("b");
    expect(screen.getAllByRole("button", { name: "「後で」から外す" })).toHaveLength(1);
  });
});
