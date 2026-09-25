import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HuddleMessage } from "./huddle-message";
import { HuddleRing } from "./huddle-ring";
import type { HuddleMessageView } from "./types";

const you = { id: "u-you", name: "あなた" };
const naoki = { id: "u-naoki", name: "佐藤 直樹" };
const miyuki = { id: "u-miyuki", name: "高橋 みゆき" };

function huddle(overrides: Partial<HuddleMessageView> = {}): HuddleMessageView {
  return { key: "h-1", starter: naoki, timeLabel: "11:20", state: "active", participants: [naoki, miyuki], ...overrides };
}

describe("HuddleMessage（ADR 0066 決定 12）", () => {
  it("進行中は、いま入っている人と「参加」を出す", async () => {
    const onJoin = vi.fn();
    render(<HuddleMessage huddle={huddle()} onJoin={onJoin} />);

    const article = screen.getByRole("article", { name: "佐藤 直樹 11:20" });
    expect(within(article).getByText("ハドルミーティングを開始しました")).toBeInTheDocument();
    expect(within(article).getByText("ハドルミーティング中")).toBeInTheDocument();
    expect(within(article).getByText("佐藤 直樹、高橋 みゆき が参加中")).toBeInTheDocument();
    await userEvent.click(within(article).getByRole("button", { name: "参加" }));
    expect(onJoin).toHaveBeenCalledOnce();
  });

  it("自分が入っていれば、「参加」の代わりに「参加中」を出す", () => {
    render(<HuddleMessage huddle={huddle({ participants: [you, naoki], joined: true })} />);

    expect(screen.queryByRole("button", { name: "参加" })).not.toBeInTheDocument();
    expect(screen.getByText("参加中")).toBeInTheDocument();
  });

  it("終わったら、所要時間と参加した人を出し、入れなくする", () => {
    render(
      <HuddleMessage
        huddle={huddle({
          state: "ended",
          participants: [you, naoki, miyuki],
          participantsLabel: "あなた、佐藤 直樹、ほか 1 人が参加しました",
          durationLabel: "12 分",
        })}
      />,
    );

    expect(screen.getByText("ハドルミーティングは終了しました")).toBeInTheDocument();
    expect(screen.getByText("12 分 · あなた、佐藤 直樹、ほか 1 人が参加しました")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("DM で入らなかった人には不在着信、始めた人には応答なしと出す", () => {
    const { rerender } = render(<HuddleMessage huddle={huddle({ state: "missed", participants: [naoki] })} />);
    expect(screen.getByText("不在着信")).toBeInTheDocument();
    expect(screen.getByText("佐藤 直樹 さんからのハドルミーティング")).toBeInTheDocument();

    rerender(<HuddleMessage huddle={huddle({ starter: you, state: "unanswered", participants: [you] })} />);
    expect(screen.getByText("応答なし")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("HuddleRing（ADR 0066 決定 11）", () => {
  it("相手を名乗り、「参加」と「もうすぐ参加する」を出す。拒否のボタンはない", async () => {
    const onJoin = vi.fn();
    const onJoinSoon = vi.fn();
    render(<HuddleRing caller={naoki} onJoin={onJoin} onJoinSoon={onJoinSoon} />);

    const ring = screen.getByRole("alertdialog", { name: "佐藤 直樹 さんからのハドルミーティング" });
    expect(within(ring).getAllByRole("button").map((b) => b.textContent)).toEqual(["もうすぐ参加する", "参加"]);
    await userEvent.click(within(ring).getByRole("button", { name: "もうすぐ参加する" }));
    await userEvent.click(within(ring).getByRole("button", { name: "参加" }));
    expect(onJoinSoon).toHaveBeenCalledOnce();
    expect(onJoin).toHaveBeenCalledOnce();
  });
});
