import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sidebar } from "./sidebar";
import type { RoomSummaryView } from "./types";

const workspace = { id: "w1", name: "hibari 開発" };
const currentUser = { id: "u1", name: "あなた" };

const rooms: RoomSummaryView[] = [
  { id: "r1", kind: "public", name: "デザインレビュー", lastMessage: "中村 涼: 確認します", timeLabel: "11:05", unreadCount: 0 },
  { id: "r2", kind: "private", name: "リリース準備", timeLabel: "昨日", unreadCount: 3 },
  { id: "d1", kind: "dm", name: "佐藤 直樹", peer: { id: "u2", online: true }, unreadCount: 0 },
  { id: "d2", kind: "dm", name: "中村 涼", peer: { id: "u3", online: false }, unreadCount: 1 },
];

function renderSidebar(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return render(
    <Sidebar
      workspace={workspace}
      currentUser={currentUser}
      rooms={rooms}
      selectedRoomId="r1"
      roomHref={(id) => `/rooms/${id}`}
      {...props}
    />,
  );
}

describe("Sidebar", () => {
  it("splits channels and direct messages", () => {
    renderSidebar();

    const channels = screen.getByRole("heading", { name: "チャンネル" }).parentElement!;
    const dms = screen.getByRole("heading", { name: "ダイレクトメッセージ" }).parentElement!;
    expect(within(channels).getAllByRole("link").map((a) => a.textContent)).toEqual([
      expect.stringContaining("デザインレビュー"),
      expect.stringContaining("リリース準備"),
    ]);
    expect(within(dms).getAllByRole("link")).toHaveLength(2);
  });

  it("marks the selected room and links every room", () => {
    renderSidebar();

    expect(screen.getByRole("link", { current: "page" })).toHaveAttribute("href", "/rooms/r1");
    expect(screen.getByRole("link", { name: /リリース準備/ })).toHaveAttribute("href", "/rooms/r2");
  });

  it("shows unread counts only for rooms with unread messages", () => {
    renderSidebar();

    expect(screen.getByLabelText("未読 3 件")).toBeInTheDocument();
    expect(screen.getByLabelText("未読 1 件")).toBeInTheDocument();
    expect(screen.queryByLabelText("未読 0 件")).not.toBeInTheDocument();
  });

  it("shows presence only for online DM peers", () => {
    renderSidebar();

    const online = screen.getByRole("link", { name: /佐藤 直樹/ });
    const offline = screen.getByRole("link", { name: /^中村 涼/ });
    expect(within(online).getByRole("img", { name: "オンライン" })).toBeInTheDocument();
    expect(within(offline).queryByRole("img", { name: "オンライン" })).not.toBeInTheDocument();
  });

  it("invites to create a channel when there are no rooms", () => {
    renderSidebar({ rooms: [] });

    expect(screen.getByText("まだチャンネルがありません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "チャンネルを作成" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "チャンネル" })).not.toBeInTheDocument();
  });

  it("renders the workspace switcher only while it is open", () => {
    const { rerender } = renderSidebar({ switcher: <div>switcher</div> });
    expect(screen.queryByText("switcher")).not.toBeInTheDocument();

    rerender(
      <Sidebar
        workspace={workspace}
        currentUser={currentUser}
        rooms={rooms}
        roomHref={(id) => `/rooms/${id}`}
        switcherOpen
        switcher={<div>switcher</div>}
      />,
    );
    expect(screen.getByText("switcher")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hibari 開発/ })).toHaveAttribute("aria-expanded", "true");
  });
});
