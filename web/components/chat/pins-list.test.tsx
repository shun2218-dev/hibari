import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PinsList } from "./pins-list";
import type { PinnedMessageView } from "./types";

const naoki = { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹" };

const pins: PinnedMessageView[] = [
  { key: "m1", href: "/w/w1/r/r1?m=m1", sender: naoki, timeLabel: "今日 10:12", body: "縦バーは 2px で十分でした。", attachmentCount: 2, inThread: false },
  { key: "m2", href: "/w/w1/r/r1?m=m2&t=m0", sender: naoki, timeLabel: "今日 09:48", body: "スレッドの返信です。", attachmentCount: 0, inThread: true },
];

describe("PinsList（ADR 0054）", () => {
  it("受け取った順にカードを並べ、カードごとにそのメッセージへのリンクを出す", () => {
    render(<PinsList roomKind="public" pins={pins} />);

    const cards = within(screen.getByRole("list", { name: "ピン留めしたメッセージ" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByRole("link")).toHaveAttribute("href", "/w/w1/r/r1?m=m1");
    expect(within(cards[0]).getByText("2 件の添付")).toBeInTheDocument();
    expect(within(cards[1]).getByText("スレッドの返信")).toBeInTheDocument();
  });

  it("カードを押すと onOpen を呼ぶ（呼ぶ側が「メッセージ」のタブに戻す）", async () => {
    const onOpen = vi.fn();
    render(<PinsList roomKind="public" pins={pins} onOpen={onOpen} />);

    await userEvent.click(screen.getAllByRole("link", { name: /のメッセージへ移動/ })[1]);
    expect(onOpen).toHaveBeenCalledWith("m2");
  });

  it("外せる人にだけ「ピンを外す」を出し、押すとそのカードの key で呼ぶ", async () => {
    const onUnpin = vi.fn();
    const { rerender } = render(<PinsList roomKind="public" pins={pins} onUnpin={onUnpin} />);

    await userEvent.click(screen.getAllByRole("button", { name: "ピンを外す" })[1]);
    expect(onUnpin).toHaveBeenCalledWith("m2");

    rerender(<PinsList roomKind="public" pins={pins} />);
    expect(screen.queryByRole("button", { name: "ピンを外す" })).not.toBeInTheDocument();
  });

  it.each([
    { kind: "public" as const, hint: "「チャンネルへピン留めする」" },
    { kind: "dm" as const, hint: "「この会話にピン留めする」" },
  ])("まだないときは、どうすればピン留めできるかを出す（$kind）", ({ kind, hint }) => {
    render(<PinsList roomKind={kind} pins={[]} />);

    expect(screen.getByText("ピン留めしたメッセージはありません")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(hint))).toBeInTheDocument();
  });

  it("取得中は一覧も空の案内も出さない", () => {
    render(<PinsList roomKind="public" />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("ピン留めしたメッセージはありません")).not.toBeInTheDocument();
  });
});
