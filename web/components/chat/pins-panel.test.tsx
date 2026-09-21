import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PinsPanel } from "./pins-panel";
import type { PinnedMessageView } from "./types";

const naoki = { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹" };

const pins: PinnedMessageView[] = [
  {
    key: "m1",
    href: "/w/w1/r/r1?m=m1",
    sender: naoki,
    timeLabel: "今日 10:12",
    body: "左の縦バーは 2px で十分でした。",
    attachmentCount: 2,
    pinnedBy: "中村 涼",
    inThread: false,
  },
  {
    key: "m2",
    href: "/w/w1/r/r1?m=m2&t=m0",
    sender: naoki,
    timeLabel: "今日 09:48",
    body: "スレッドの返信です。",
    attachmentCount: 0,
    pinnedBy: "あなた",
    inThread: true,
  },
];

describe("PinsPanel（ADR 0054）", () => {
  it("受け取った順に並べ、行ごとにそのメッセージへのリンクを出す", () => {
    render(<PinsPanel room={{ kind: "public", name: "デザインレビュー" }} pins={pins} />);

    const rows = within(screen.getByRole("list", { name: "ピン留めしたメッセージ" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "/w/w1/r/r1?m=m1");
    expect(within(rows[0]).getByText("中村 涼 がピン留め")).toBeInTheDocument();
    expect(within(rows[0]).getByText("2 件の添付")).toBeInTheDocument();
    expect(within(rows[1]).getByText("スレッドの返信")).toBeInTheDocument();
  });

  it("外せる人にだけ「ピンを外す」を出し、押すとその行の key で呼ぶ", async () => {
    const onUnpin = vi.fn();
    const { rerender } = render(<PinsPanel room={{ kind: "public", name: "デザインレビュー" }} pins={pins} onUnpin={onUnpin} />);

    await userEvent.click(screen.getAllByRole("button", { name: "ピンを外す" })[1]);
    expect(onUnpin).toHaveBeenCalledWith("m2");

    rerender(<PinsPanel room={{ kind: "public", name: "デザインレビュー" }} pins={pins} />);
    expect(screen.queryByRole("button", { name: "ピンを外す" })).not.toBeInTheDocument();
  });

  it.each([
    { kind: "public" as const, hint: "「チャンネルへピン留めする」" },
    { kind: "dm" as const, hint: "「この会話にピン留めする」" },
  ])("まだないときは、どうすればピン留めできるかを出す（$kind）", ({ kind, hint }) => {
    render(<PinsPanel room={{ kind, name: "デザインレビュー" }} pins={[]} />);

    expect(screen.getByText("ピン留めしたメッセージはありません")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(hint))).toBeInTheDocument();
  });

  it("取得中は一覧も空の案内も出さない", () => {
    render(<PinsPanel room={{ kind: "public", name: "デザインレビュー" }} />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("ピン留めしたメッセージはありません")).not.toBeInTheDocument();
  });

  it("閉じるボタンで onClose を呼ぶ", async () => {
    const onClose = vi.fn();
    render(<PinsPanel room={{ kind: "public", name: "デザインレビュー" }} pins={pins} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "ピン留めを閉じる" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
