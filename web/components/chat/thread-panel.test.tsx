import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThreadPanel } from "./thread-panel";
import { Timeline } from "./timeline";
import type { MessageView, TimelineItem } from "./types";

function message(key: string, overrides: Partial<MessageView> = {}): MessageView {
  return {
    key,
    sender: { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹" },
    timeLabel: "10:12",
    body: `本文 ${key}`,
    status: "sent",
    deleted: false,
    edited: false,
    attachments: [],
    grouped: false,
    ...overrides,
  };
}

function items(root: MessageView, replies: MessageView[], replyCount = replies.length): TimelineItem[] {
  return [
    { type: "message", message: root },
    { type: "thread-divider", key: "divider", replyCount },
    ...replies.map((m): TimelineItem => ({ type: "message", message: m })),
  ];
}

const room = { kind: "public", name: "デザインレビュー" } as const;

describe("ThreadPanel", () => {
  it("shows the room, the root, the reply count and the replies in the given order", () => {
    render(
      <ThreadPanel room={room} footer={<p>入力欄</p>}>
        <Timeline items={items(message("root"), [message("r1"), message("r2", { status: "pending" })])} />
      </ThreadPanel>,
    );

    const panel = screen.getByRole("complementary", { name: "スレッド" });
    expect(within(panel).getByText("デザインレビュー")).toBeInTheDocument();
    expect(within(panel).getByText("2 件の返信")).toBeInTheDocument();
    expect(within(panel).getAllByRole("article").map((a) => a.textContent)).toEqual([
      expect.stringContaining("本文 root"),
      expect.stringContaining("本文 r1"),
      expect.stringContaining("本文 r2"),
    ]);
    expect(within(panel).getByText("入力欄")).toBeInTheDocument();
  });

  it("offers no reply action inside the thread (threads are not nested)", () => {
    render(
      <ThreadPanel room={room}>
        <Timeline items={items(message("root"), [message("r1")])} />
      </ThreadPanel>,
    );

    expect(screen.queryByRole("button", { name: "返信", hidden: true })).not.toBeInTheDocument();
  });

  it("says there are no replies yet", () => {
    render(
      <ThreadPanel room={room}>
        <Timeline items={items(message("root"), [])} />
      </ThreadPanel>,
    );

    expect(screen.getByText("まだ返信はありません")).toBeInTheDocument();
    expect(screen.queryByText(/件の返信/)).not.toBeInTheDocument();
  });

  it("keeps the thread when the root is deleted", () => {
    render(
      <ThreadPanel room={room}>
        <Timeline items={items(message("root", { deleted: true, body: "" }), [message("r1")])} />
      </ThreadPanel>,
    );

    expect(screen.getByText("このメッセージは削除されました")).toBeInTheDocument();
    expect(screen.getByText("本文 r1")).toBeInTheDocument();
  });

  it("closes from the close button (desktop) and the back button (mobile)", async () => {
    const onClose = vi.fn();
    render(<ThreadPanel room={room} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "スレッドを閉じる" }));
    await userEvent.click(screen.getByRole("button", { name: "チャンネルに戻る" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
