import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DmList } from "./dm-list";
import type { RoomSummaryView } from "./types";

const rooms: RoomSummaryView[] = [
  {
    id: "d1",
    kind: "dm",
    name: "佐藤 直樹",
    peer: { id: "u2", presence: "online" },
    lastMessage: "縦バーの件、あとで画面で見ます",
    timeLabel: "10:14",
    unreadCount: 0,
    mentionCount: 0,
  },
  {
    id: "d2",
    kind: "dm",
    name: "高橋 みゆき",
    peer: { id: "u3", presence: "offline" },
    lastMessage: "モックのリンク送りますね",
    timeLabel: "09:58",
    unreadCount: 1,
    mentionCount: 0,
  },
];

describe("DmList", () => {
  it("lists each DM with its last message in the given order", () => {
    render(<DmList rooms={rooms} roomHref={(id) => `/r/${id}`} selectedRoomId="d2" />);

    const list = screen.getByRole("list", { name: "ダイレクトメッセージ" });
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/r/d1", "/r/d2"]);
    expect(links[0]).toHaveTextContent("縦バーの件、あとで画面で見ます");
    expect(links[1]).toHaveAttribute("aria-current", "page");
    // DM は 1 通が知らせなので、未読の数をそのまま出す（ホームの DM の行と同じ）
    expect(within(links[1]).getByLabelText("未読 1 件")).toBeInTheDocument();
  });

  it("starts a new DM from the + button and from the empty state", async () => {
    const user = userEvent.setup();
    const onStartDm = vi.fn();
    render(<DmList rooms={[]} roomHref={(id) => id} onStartDm={onStartDm} />);

    expect(screen.getByText("ダイレクトメッセージはまだありません")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "ダイレクトメッセージを開く" })) await user.click(button);
    expect(onStartDm).toHaveBeenCalledTimes(2);
  });
});
