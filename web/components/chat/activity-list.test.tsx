import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActivityList } from "./activity-list";
import type { ActivityItemView } from "./types";

const naoki = { id: "u2", name: "佐藤 直樹" };
const miyuki = { id: "u3", name: "高橋 みゆき" };

function item(overrides: Partial<ActivityItemView> & Pick<ActivityItemView, "key" | "reasons">): ActivityItemView {
  return {
    href: `/m/${overrides.key}`,
    unread: false,
    room: { kind: "public", name: "デザインレビュー" },
    actor: naoki,
    body: "本文",
    attachmentCount: 0,
    dateLabel: "今日",
    timeLabel: "09:00",
    ...overrides,
  };
}

const items: ActivityItemView[] = [
  item({ key: "a1", reasons: ["dm"], room: { kind: "dm", name: miyuki.name }, actor: miyuki, unread: true, body: "モックのリンク送りますね" }),
  item({ key: "a2", reasons: ["mention"], body: "見てもらえますか？" }),
  item({ key: "a3", reasons: ["thread"], room: { kind: "private", name: "リリース準備" }, threadRootExcerpt: "金曜のリリース手順です" }),
  item({ key: "a4", reasons: ["reaction"], actor: miyuki, reactionEmoji: "☕", body: "駅前の喫茶店", dateLabel: "昨日" }),
  item({ key: "a5", reasons: ["channel"], dateLabel: "昨日" }),
];

function renderList(props: Partial<Parameters<typeof ActivityList>[0]> = {}) {
  return render(<ActivityList filter="all" unreadOnly={false} items={items} {...props} />);
}

describe("ActivityList", () => {
  it("lists each item as its own link to the message, split by date", () => {
    renderList();

    const list = screen.getByRole("list", { name: "すべて" });
    const links = within(list).getAllByRole("link");
    // チャンネルごとにまとめず、1 件ずつ（ADR 0058 決定 2）
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/m/a1", "/m/a2", "/m/a3", "/m/a4", "/m/a5"]);
    // 日付が変わるところにだけ区切りを入れる
    expect(within(list).getAllByText(/^(今日|昨日)$/).map((el) => el.textContent)).toEqual(["今日", "昨日"]);
  });

  it("says what happened in words that match the reason", () => {
    renderList();

    const [dm, mention, thread, reaction, channel] = within(screen.getByRole("list", { name: "すべて" })).getAllByRole("link");
    expect(dm).toHaveTextContent("ダイレクトメッセージ");
    expect(mention).toHaveTextContent("デザインレビューでメンション");
    expect(thread).toHaveTextContent("リリース準備のスレッドへの返信");
    expect(thread).toHaveTextContent("「金曜のリリース手順です」");
    expect(reaction).toHaveTextContent("あなたのメッセージにリアクション");
    expect(reaction).toHaveTextContent("☕");
    expect(channel).toHaveTextContent("デザインレビューへの投稿");
  });

  it("prefers the mention over the DM when one item has both reasons", () => {
    renderList({ items: [item({ key: "a1", reasons: ["dm", "mention"], room: { kind: "dm", name: miyuki.name } })] });

    expect(screen.getByRole("link")).toHaveTextContent("ダイレクトメッセージでメンション");
  });

  it("marks unread items so they can be told apart from read ones", () => {
    renderList();

    const [dm, mention] = within(screen.getByRole("list", { name: "すべて" })).getAllByRole("link");
    expect(within(dm).getByText("未読")).toBeInTheDocument();
    expect(within(mention).queryByText("未読")).not.toBeInTheDocument();
  });

  it("switches the tab and the unread-only toggle", async () => {
    const user = userEvent.setup();
    const onChangeFilter = vi.fn();
    const onToggleUnreadOnly = vi.fn();
    renderList({ onChangeFilter, onToggleUnreadOnly });

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["すべて", "DM", "メンション", "スレッド", "リアクション"]);
    await user.click(screen.getByRole("tab", { name: "リアクション" }));
    expect(onChangeFilter).toHaveBeenCalledWith("reaction");

    const toggle = screen.getByRole("button", { name: "未読メッセージ" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(onToggleUnreadOnly).toHaveBeenCalled();
  });

  it.each([
    ["all", false, "アクティビティはまだありません"],
    ["mention", false, "メンションはまだありません"],
    ["reaction", false, "リアクションはまだありません"],
    ["all", true, "未読のアクティビティはありません"],
  ] as const)("shows the empty state for %s (unread only: %s)", (filter, unreadOnly, title) => {
    renderList({ filter, unreadOnly, items: [] });

    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it("draws nothing in the panel while loading", () => {
    renderList({ items: undefined });

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("アクティビティはまだありません")).not.toBeInTheDocument();
  });
});
