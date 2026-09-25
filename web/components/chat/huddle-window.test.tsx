import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HuddleMobileBar, HuddleProblemNotice, HuddleWindow } from "./huddle-window";
import type { HuddleWindowView } from "./types";

const you = { id: "u-you", name: "あなた" };
const naoki = { id: "u-naoki", name: "佐藤 直樹" };
const miyuki = { id: "u-miyuki", name: "高橋 みゆき" };

function huddle(overrides: Partial<HuddleWindowView> = {}): HuddleWindowView {
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

describe("HuddleWindow（ADR 0066 決定 17）", () => {
  it("ルームと参加者を出し、話している人とミュートしている人を読み上げで区別する", () => {
    render(<HuddleWindow huddle={huddle()} />);

    const section = screen.getByRole("region", { name: "ハドルミーティング" });
    expect(within(section).getByText("デザインレビュー")).toBeInTheDocument();
    expect(within(section).getByText("3 人が参加中")).toBeInTheDocument();
    const list = within(section).getByRole("list", { name: "参加者" });
    expect(within(list).getByRole("img", { name: "あなた" })).toBeInTheDocument();
    expect(within(list).getByRole("img", { name: "佐藤 直樹（話しています）" })).toBeInTheDocument();
    expect(within(list).getByRole("img", { name: "高橋 みゆき（ミュート中）" })).toBeInTheDocument();
  });

  it("ミュートのボタンは、押したときの操作を名前にし、押した状態を持つ", async () => {
    const onToggleMute = vi.fn();
    const { rerender } = render(<HuddleWindow huddle={huddle()} onToggleMute={onToggleMute} />);

    const mute = screen.getByRole("button", { name: "ミュート" });
    expect(mute).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(mute);
    expect(onToggleMute).toHaveBeenCalledOnce();

    rerender(<HuddleWindow huddle={huddle({ muted: true })} onToggleMute={onToggleMute} />);
    expect(screen.getByRole("button", { name: "ミュートを解除" })).toHaveAttribute("aria-pressed", "true");
  });

  it("「退出」で抜ける", async () => {
    const onLeave = vi.fn();
    render(<HuddleWindow huddle={huddle()} onLeave={onLeave} />);

    await userEvent.click(screen.getByRole("button", { name: "退出" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("「もうすぐ参加する」を押した人を出す（決定 11）", () => {
    render(<HuddleWindow huddle={huddle({ joiningSoon: [naoki] })} />);

    expect(screen.getByText("佐藤 直樹 さんがもうすぐ参加します")).toBeInTheDocument();
  });

  it.each([
    ["connecting", "接続しています…"],
    ["reconnecting", "再接続しています…"],
  ] as const)("%s のときは、つないでいることを知らせる", (connection, text) => {
    render(<HuddleWindow huddle={huddle({ connection })} />);

    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.queryByText("3 人が参加中")).not.toBeInTheDocument();
  });
});

describe("HuddleMobileBar", () => {
  it("ルーム・人数・ミュート・退出を 1 行に出す", () => {
    render(<HuddleMobileBar huddle={huddle()} />);

    const section = screen.getByRole("region", { name: "ハドルミーティング" });
    expect(within(section).getByText("デザインレビュー")).toBeInTheDocument();
    expect(within(section).getByText("3 人が参加中")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "ミュート" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "退出" })).toBeInTheDocument();
  });

  it("つないでいる間は、人数の代わりにその状態を出す", () => {
    render(<HuddleMobileBar huddle={huddle({ connection: "reconnecting" })} />);

    expect(screen.getByText("再接続しています…")).toBeInTheDocument();
  });
});

describe("HuddleProblemNotice", () => {
  it.each([
    ["mic-denied", "マイクを使えません", true],
    ["no-mic", "マイクが見つかりません", true],
    ["failed", "接続できませんでした", true],
    ["full", "参加できる人数の上限に達しています", true],
    ["disconnected", "ハドルミーティングから切断されました", true],
    ["removed", "ハドルミーティングから外れました", false],
  ] as const)("%s は「%s」と知らせ、入り直せるときだけ「もう一度参加」を出す", (problem, title, retry) => {
    render(<HuddleProblemNotice problem={problem} room={{ kind: "public", name: "デザインレビュー" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent(title);
    expect(screen.queryByRole("button", { name: "もう一度参加" }) !== null).toBe(retry);
  });

  it("閉じると入り直しを押せる", async () => {
    const onClose = vi.fn();
    const onRetry = vi.fn();
    render(
      <HuddleProblemNotice problem="failed" room={{ kind: "dm", name: "佐藤 直樹" }} onClose={onClose} onRetry={onRetry} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "もう一度参加" }));
    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
