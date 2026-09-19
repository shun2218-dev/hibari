import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

    const channels = screen.getByRole("heading", { name: "チャンネル" }).closest("section")!;
    const dms = screen.getByRole("heading", { name: "ダイレクトメッセージ" }).closest("section")!;
    expect(within(channels).getAllByRole("link").map((a) => a.textContent)).toEqual([
      expect.stringContaining("デザインレビュー"),
      expect.stringContaining("リリース準備"),
    ]);
    expect(within(dms).getAllByRole("link")).toHaveLength(2);
  });

  it("offers a way to add to each section (チャンネルを作成 / DM を開く)", async () => {
    const user = userEvent.setup();
    const onCreateRoom = vi.fn();
    const onStartDm = vi.fn();
    renderSidebar({ onCreateRoom, onStartDm });

    await user.click(screen.getByRole("button", { name: "チャンネルを作成" }));
    await user.click(screen.getByRole("button", { name: "ダイレクトメッセージを開く" }));

    expect(onCreateRoom).toHaveBeenCalled();
    expect(onStartDm).toHaveBeenCalled();
  });

  it("keeps both section headings even when one of them is empty", () => {
    renderSidebar({ rooms: rooms.filter((r) => r.kind !== "dm") });

    // DM が 0 件でも、見出しの「+」から相手を選べる
    expect(screen.getByRole("heading", { name: "ダイレクトメッセージ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ダイレクトメッセージを開く" })).toBeInTheDocument();
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

describe("Sidebar empty states", () => {
  it("distinguishes no rooms from no search results", () => {
    const { rerender } = renderSidebar({ rooms: [] });
    expect(screen.getByText("まだチャンネルがありません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "チャンネルを作成" })).toBeInTheDocument();

    rerender(
      <Sidebar
        workspace={workspace}
        currentUser={currentUser}
        rooms={[]}
        search="見積"
        roomHref={(id) => `/rooms/${id}`}
      />,
    );
    expect(screen.getByText("一致するチャンネルがありません")).toBeInTheDocument();
    expect(screen.getByText("別の言葉を試すか、チャンネルを作成してください")).toBeInTheDocument();
    // 検索して 0 件のときは、作成のボタンを出さない（検索を直すほうが先）
    expect(screen.queryByRole("button", { name: "チャンネルを作成" })).not.toBeInTheDocument();
  });

  it("opens the account menu from the avatar", async () => {
    const onToggleAccountMenu = vi.fn();
    const { rerender } = renderSidebar({ onToggleAccountMenu, accountMenu: <div>menu</div> });
    expect(screen.queryByText("menu")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "アカウントメニュー" }));
    expect(onToggleAccountMenu).toHaveBeenCalledOnce();

    rerender(
      <Sidebar
        workspace={workspace}
        currentUser={currentUser}
        rooms={rooms}
        roomHref={(id) => `/rooms/${id}`}
        accountMenuOpen
        accountMenu={<div>menu</div>}
      />,
    );
    expect(screen.getByText("menu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "アカウントメニュー" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the threads entry with the number of threads that have unread replies (ADR 0036)", () => {
    renderSidebar({ threads: { href: "/threads", unreadCount: 2, selected: false } });

    const link = screen.getByRole("link", { name: /スレッド/ });
    expect(link).toHaveAttribute("href", "/threads");
    expect(within(link).getByLabelText("未読 2 件")).toBeInTheDocument();
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("marks the threads entry as current while the thread list is open", () => {
    renderSidebar({ selectedRoomId: undefined, threads: { href: "/threads", unreadCount: 0, selected: true } });

    const link = screen.getByRole("link", { name: /スレッド/ });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(within(link).queryByLabelText(/未読/)).not.toBeInTheDocument();
  });

  it("does not show the threads entry unless given", () => {
    renderSidebar();

    expect(screen.queryByRole("link", { name: /スレッド/ })).not.toBeInTheDocument();
  });
});
