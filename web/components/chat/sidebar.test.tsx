import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Sidebar } from "./sidebar";
import type { RoomSummaryView } from "./types";

const workspace = { id: "w1", name: "hibari 開発" };
const currentUser = { id: "u1", name: "あなた" };

const rooms: RoomSummaryView[] = [
  { id: "r1", kind: "public", name: "デザインレビュー", lastMessage: "中村 涼: 確認します", timeLabel: "11:05", unreadCount: 0, mentionCount: 0 },
  { id: "r2", kind: "private", name: "リリース準備", timeLabel: "昨日", unreadCount: 3, mentionCount: 0 },
  { id: "d1", kind: "dm", name: "佐藤 直樹", peer: { id: "u2", presence: "online" }, unreadCount: 0, mentionCount: 0 },
  { id: "d2", kind: "dm", name: "中村 涼", peer: { id: "u3", presence: "offline" }, unreadCount: 1, mentionCount: 0 },
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

    // DM の未読は数字のバッジ、チャンネルの未読は名前の太字（ADR 0043）
    expect(screen.getByLabelText("未読 1 件")).toBeInTheDocument();
    expect(screen.getByText("リリース準備")).toHaveClass("font-bold");
    expect(screen.queryByLabelText("未読 3 件")).not.toBeInTheDocument();
    expect(screen.getByText("デザインレビュー")).not.toHaveClass("font-bold");
  });

  it("数字のバッジは知らせが要るものだけに出す（ADR 0043）", () => {
    renderSidebar({
      rooms: [
        { id: "r1", kind: "public", name: "デザインレビュー", timeLabel: "11:05", unreadCount: 7, mentionCount: 2 },
        { id: "r2", kind: "private", name: "リリース準備", timeLabel: "昨日", unreadCount: 3, mentionCount: 0 },
        { id: "r3", kind: "public", name: "雑談", timeLabel: "昨日", unreadCount: 0, mentionCount: 0 },
        { id: "d1", kind: "dm", name: "佐藤 直樹", peer: { id: "u2", presence: "online" }, unreadCount: 2, mentionCount: 0 },
      ],
    });

    // 自分宛てのあるチャンネルは @2。未読の 7 はバッジにしない（名前の太字で示す）
    expect(screen.getByLabelText("メンション 2 件")).toHaveTextContent("@2");
    expect(screen.getByText("デザインレビュー")).toHaveClass("font-bold");
    expect(screen.queryByLabelText("未読 7 件")).not.toBeInTheDocument();

    // 自分宛てのない未読のチャンネルは、太字だけでバッジは出さない
    expect(screen.getByText("リリース準備")).toHaveClass("font-bold");
    expect(within(screen.getByRole("link", { name: /リリース準備/ })).queryByLabelText(/未読|メンション/)).not.toBeInTheDocument();

    // DM は 1 通が知らせなので、未読の数をそのまま出す
    expect(screen.getByLabelText("未読 2 件")).toHaveTextContent("2");

    // 何もなければ太字にもバッジにもしない
    expect(screen.getByText("雑談")).not.toHaveClass("font-bold");
  });

  it("ミュートしたルームは薄くし、未読を強調しないが、メンションの数は出す（ADR 0055 決定 6）", () => {
    renderSidebar({
      rooms: [
        { id: "r1", kind: "public", name: "デザインレビュー", unreadCount: 7, mentionCount: 0, muted: true },
        { id: "r2", kind: "private", name: "リリース準備", unreadCount: 3, mentionCount: 1, muted: true },
        { id: "d1", kind: "dm", name: "佐藤 直樹", peer: { id: "u2", presence: "online" }, unreadCount: 2, mentionCount: 0, muted: true },
      ],
    });

    // 未読があっても太字にしない。色で薄くし、読み上げには言葉で添える
    const design = screen.getByRole("link", { name: /デザインレビュー/ });
    expect(design).toHaveAccessibleName(expect.stringContaining("（ミュート中）"));
    expect(within(design).getByText("デザインレビュー", { exact: false })).not.toHaveClass("font-bold");
    expect(within(design).getByText("デザインレビュー", { exact: false })).toHaveClass("text-text-muted");

    // 自分宛てのメンションはミュートしていても分かるようにする
    expect(screen.getByLabelText("メンション 1 件")).toHaveTextContent("@1");

    // ミュートした DM は、未読の数のバッジを出さない
    expect(screen.queryByLabelText("未読 2 件")).not.toBeInTheDocument();
  });

  it("検索の下に帯を置ける（デスクトップ通知。ADR 0057）", () => {
    renderSidebar({ notice: <p>帯</p> });

    expect(screen.getByText("帯")).toBeInTheDocument();
  });

  it("shows presence only for online DM peers", () => {
    renderSidebar();

    const online = screen.getByRole("link", { name: /佐藤 直樹/ });
    const offline = screen.getByRole("link", { name: /^中村 涼/ });
    expect(within(online).getByRole("img", { name: "オンライン" })).toBeInTheDocument();
    expect(within(offline).queryByRole("img", { name: "オンライン" })).not.toBeInTheDocument();
  });

  // ADR 0049: 離席は色を持たないドット、ステータスは絵文字だけを名前の横に出す
  it("離席の DM の相手には、離席のドットとステータスの絵文字を出す", () => {
    renderSidebar({
      rooms: [
        {
          id: "d1",
          kind: "dm",
          name: "佐藤 直樹",
          peer: { id: "u2", presence: "away", status: { emoji: "📅", text: "会議中" } },
          unreadCount: 0,
          mentionCount: 0,
        },
      ],
    });

    const row = screen.getByRole("link", { name: /佐藤 直樹/ });
    expect(within(row).getByRole("img", { name: "離席中" })).toBeInTheDocument();
    expect(within(row).getByRole("img", { name: "ステータス: 📅 会議中" })).toBeInTheDocument();
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

  it("hides the threads entry while searching channels", () => {
    renderSidebar({ search: "デザ", threads: { href: "/threads", unreadCount: 1, selected: false } });

    expect(screen.queryByRole("link", { name: /スレッド/ })).not.toBeInTheDocument();
  });

  it("does not show the threads entry unless given", () => {
    renderSidebar();

    expect(screen.queryByRole("link", { name: /スレッド/ })).not.toBeInTheDocument();
  });
});

describe("Sidebar の「後で」（ADR 0054）", () => {
  it("渡したときだけ「後で」への入口を出し、件数のバッジは出さない", () => {
    renderSidebar({ saved: { href: "/saved", selected: false } });

    const link = screen.getByRole("link", { name: "後で" });
    expect(link).toHaveAttribute("href", "/saved");
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("開いているときは選択中にする", () => {
    renderSidebar({ saved: { href: "/saved", selected: true }, selectedRoomId: undefined });

    expect(screen.getByRole("link", { name: "後で" })).toHaveAttribute("aria-current", "page");
  });

  it("渡さなければ出さない", () => {
    renderSidebar();

    expect(screen.queryByRole("link", { name: "後で" })).not.toBeInTheDocument();
  });

  it("チャンネルを検索している間は出さない", () => {
    renderSidebar({ saved: { href: "/saved", selected: false }, search: "デザ" });

    expect(screen.queryByRole("link", { name: "後で" })).not.toBeInTheDocument();
  });

  it("moves the account button to the left menu on md and up when railed (ADR 0058)", () => {
    const { rerender } = renderSidebar();
    expect(screen.getByRole("button", { name: "アカウントメニュー" })).not.toHaveClass("md:hidden");

    rerender(
      <Sidebar workspace={workspace} currentUser={currentUser} rooms={rooms} roomHref={(id) => `/rooms/${id}`} railed />,
    );
    // モバイルには左のメニューがないので、ボタンは残して md 以上でだけ隠す
    expect(screen.getByRole("button", { name: "アカウントメニュー" })).toHaveClass("md:hidden");
  });
});
