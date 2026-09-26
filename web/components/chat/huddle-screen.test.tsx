import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HuddleProblemScreen, HuddleScreen } from "./huddle-screen";
import type { HuddleScreenView } from "./types";

const you = { id: "u-you", name: "あなた" };
const naoki = { id: "u-naoki", name: "佐藤 直樹" };
const miyuki = { id: "u-miyuki", name: "高橋 みゆき" };

function huddle(overrides: Partial<HuddleScreenView> = {}): HuddleScreenView {
  return {
    room: { kind: "public", name: "デザインレビュー" },
    connection: "connected",
    participants: [
      { ...you, muted: false },
      { ...naoki, muted: false, speaking: true },
      { ...miyuki, muted: true },
    ],
    joiningSoon: [],
    muted: false,
    ...overrides,
  };
}

describe("HuddleScreen（ADR 0066 追記 C）", () => {
  it("ルームと人数を出し、話している人とミュートしている人を読み上げで区別する", () => {
    render(<HuddleScreen huddle={huddle()} />);

    expect(screen.getByRole("heading")).toHaveTextContent("デザインレビューでハドルミーティングを行う");
    expect(screen.getByText("3 人")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "参加者" });
    expect(within(list).getByRole("figure", { name: "あなた" })).toBeInTheDocument();
    expect(within(list).getByRole("figure", { name: "佐藤 直樹（話しています）" })).toBeInTheDocument();
    expect(within(list).getByRole("figure", { name: "高橋 みゆき（ミュート中）" })).toBeInTheDocument();
  });

  it("ミュートのボタンは、押したときの操作を名前にし、押した状態を持つ", async () => {
    const onToggleMute = vi.fn();
    const { rerender } = render(<HuddleScreen huddle={huddle()} onToggleMute={onToggleMute} />);

    await userEvent.click(screen.getByRole("button", { name: "ミュート" }));
    expect(onToggleMute).toHaveBeenCalledOnce();
    rerender(<HuddleScreen huddle={huddle({ muted: true })} />);
    expect(screen.getByRole("button", { name: "ミュートを解除" })).toHaveAttribute("aria-pressed", "true");
  });

  it("機器の選択は開いているときだけ出す", async () => {
    const onToggleDeviceMenu = vi.fn();
    const { rerender } = render(<HuddleScreen huddle={huddle()} onToggleDeviceMenu={onToggleDeviceMenu} />);

    const button = screen.getByRole("button", { name: "マイクとスピーカーを選ぶ" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(onToggleDeviceMenu).toHaveBeenCalledOnce();

    rerender(<HuddleScreen huddle={huddle()} deviceMenu={<p>メニュー</p>} />);
    expect(screen.getByRole("button", { name: "マイクとスピーカーを選ぶ" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("メニュー")).toBeInTheDocument();
  });

  it("ハドルのチャットは開いているときだけ出す（追記 A）", async () => {
    const onToggleChat = vi.fn();
    const { rerender } = render(<HuddleScreen huddle={huddle()} chat={<p>チャット</p>} onToggleChat={onToggleChat} />);

    expect(screen.queryByText("チャット")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ハドルのチャット" }));
    expect(onToggleChat).toHaveBeenCalledOnce();

    rerender(<HuddleScreen huddle={huddle()} chat={<p>チャット</p>} chatOpen />);
    expect(screen.getByText("チャット")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ハドルのチャット" })).toHaveAttribute("aria-pressed", "true");
  });

  it("「退出する」で抜ける", async () => {
    const onLeave = vi.fn();
    render(<HuddleScreen huddle={huddle()} onLeave={onLeave} />);

    await userEvent.click(screen.getByRole("button", { name: "退出する" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("「もうすぐ参加する」を押した人を出す（決定 11）", () => {
    render(<HuddleScreen huddle={huddle({ joiningSoon: [naoki] })} />);

    expect(screen.getByText("佐藤 直樹 さんがもうすぐ参加します")).toBeInTheDocument();
  });

  it.each([
    ["connecting", "接続しています…"],
    ["reconnecting", "再接続しています…"],
  ] as const)("%s のときは、人数の代わりにつないでいることを知らせる", (connection, text) => {
    render(<HuddleScreen huddle={huddle({ connection })} />);

    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.queryByText("3 人")).not.toBeInTheDocument();
  });
});

describe("HuddleProblemScreen", () => {
  it.each([
    ["failed", "接続できませんでした", true],
    ["full", "参加できる人数の上限に達しています", true],
    ["disconnected", "ハドルミーティングから切断されました", true],
    ["removed", "ハドルミーティングから外れました", false],
  ] as const)("%s は「%s」と知らせ、入り直せるときだけ「もう一度参加」を出す", (problem, title, retry) => {
    render(<HuddleProblemScreen problem={problem} room={{ kind: "public", name: "デザインレビュー" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent(title);
    expect(screen.queryByRole("button", { name: "もう一度参加" }) !== null).toBe(retry);
    expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument();
  });
});
