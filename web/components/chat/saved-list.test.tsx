import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SavedList } from "./saved-list";
import type { SavedItemView } from "./types";

const naoki = { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹" };

const items: SavedItemView[] = [
  {
    key: "m1",
    status: "ok",
    href: "/w/w1/r/r1?m=m1",
    room: { kind: "private", name: "リリース準備" },
    sender: naoki,
    timeLabel: "昨日",
    body: "金曜のリリース手順です。",
    attachmentCount: 0,
  },
  { key: "m2", status: "unavailable" },
];

describe("SavedList（ADR 0054）", () => {
  it("件数は「進行中」のタブにだけ出す", () => {
    render(<SavedList tab="in_progress" inProgressCount={2} items={items} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["進行中2", "アーカイブ済み", "完了済み"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("タブを押すと onChangeTab を呼ぶ", async () => {
    const onChangeTab = vi.fn();
    render(<SavedList tab="in_progress" inProgressCount={2} items={items} onChangeTab={onChangeTab} />);

    await userEvent.click(screen.getByRole("tab", { name: "完了済み" }));
    expect(onChangeTab).toHaveBeenCalledWith("completed");
  });

  it("読める行はメッセージへのリンク、読めない行は中身を出さずに「表示できません」にする", async () => {
    const onSelectUnavailable = vi.fn();
    render(<SavedList tab="in_progress" inProgressCount={2} items={items} onSelectUnavailable={onSelectUnavailable} />);

    const rows = within(screen.getByRole("list", { name: "進行中" })).getAllByRole("listitem");
    expect(within(rows[0]).getByRole("link", { name: "佐藤 直樹 のメッセージへ移動" })).toHaveAttribute("href", "/w/w1/r/r1?m=m1");
    expect(within(rows[0]).getByText("リリース準備")).toBeInTheDocument();

    await userEvent.click(within(rows[1]).getByRole("button", { name: "このメッセージは表示できません" }));
    expect(onSelectUnavailable).toHaveBeenCalledWith("m2");
  });

  it("進行中の行は「完了にする」で完了済みへ動かす", async () => {
    const onMove = vi.fn();
    render(<SavedList tab="in_progress" inProgressCount={2} items={items} onMove={onMove} />);

    await userEvent.click(screen.getByRole("button", { name: "完了にする" }));
    expect(onMove).toHaveBeenCalledWith("m1", "completed");
  });

  it.each([
    { tab: "in_progress" as const, entries: ["アーカイブ", "「後で」から外す"] },
    { tab: "archived" as const, entries: ["進行中に移動する", "「後で」から外す"] },
    { tab: "completed" as const, entries: ["進行中に移動する", "アーカイブ", "「後で」から外す"] },
  ])("「その他」はタブに応じて、いまのタブ以外への移動と外すを出す（$tab）", ({ tab, entries }) => {
    render(<SavedList tab={tab} inProgressCount={2} items={items} openMenuKey="m1" />);

    const menu = screen.getByRole("dialog", { name: "保存したメッセージの操作" });
    expect(within(menu).getAllByRole("button").map((button) => button.textContent)).toEqual(entries);
  });

  it("「その他」から外すと onRemove を呼ぶ", async () => {
    const onRemove = vi.fn();
    render(<SavedList tab="in_progress" inProgressCount={2} items={items} openMenuKey="m1" onRemove={onRemove} />);

    await userEvent.click(screen.getByRole("button", { name: "「後で」から外す" }));
    expect(onRemove).toHaveBeenCalledWith("m1");
  });

  it("「完了にする」はほかのタブには出さない", () => {
    render(<SavedList tab="archived" inProgressCount={2} items={items} />);

    expect(screen.queryByRole("button", { name: "完了にする" })).not.toBeInTheDocument();
  });

  it.each([
    { tab: "in_progress" as const, title: "「後で」に保存したメッセージはありません" },
    { tab: "archived" as const, title: "アーカイブしたメッセージはありません" },
    { tab: "completed" as const, title: "完了したメッセージはありません" },
  ])("空のときはタブごとの案内を出す（$tab）", ({ tab, title }) => {
    render(<SavedList tab={tab} inProgressCount={0} items={[]} />);

    expect(screen.getByText(title)).toBeInTheDocument();
  });
});
