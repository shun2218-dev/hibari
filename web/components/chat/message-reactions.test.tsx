import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MessageReactions } from "./message-reactions";
import type { MessageReactionView } from "./types";

function reaction(overrides: Partial<MessageReactionView> = {}): MessageReactionView {
  return { emoji: "👍", count: 3, me: false, names: ["高橋 みゆき", "佐藤 直樹"], ...overrides };
}

describe("MessageReactions（ADR 0044）", () => {
  it("絵文字ごとに 1 つのチップを、受け取った順に出す", () => {
    render(
      <MessageReactions
        reactions={[reaction(), reaction({ emoji: "🎉", count: 1, names: ["中村 涼"] })]}
      />,
    );

    const chips = screen.getAllByRole("button");
    expect(chips).toHaveLength(2);
    // 並びは最初に付いた順のまま。数で並べ替えない（ADR 0044 決定 3）
    expect(chips[0]).toHaveAccessibleName("高橋 みゆき、佐藤 直樹 他 1 人が 👍 を付けました");
    expect(chips[1]).toHaveAccessibleName("中村 涼が 🎉 を付けました");
  });

  it("自分が付けているチップだけを、押している状態にする", () => {
    render(<MessageReactions reactions={[reaction({ me: true }), reaction({ emoji: "🎉", me: false })]} />);

    const [mine, others] = screen.getAllByRole("button");
    expect(mine).toHaveAttribute("aria-pressed", "true");
    expect(others).toHaveAttribute("aria-pressed", "false");
  });

  it("チップを押すと、その絵文字を渡して呼ぶ", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<MessageReactions reactions={[reaction({ emoji: "🎉" })]} onToggle={onToggle} />);

    await user.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledWith("🎉");
  });

  it("誰が付けたかを、ホバーで読める形でも持っている", () => {
    render(<MessageReactions reactions={[reaction({ count: 5 })]} forceHoverEmoji="👍" />);

    // 吹き出しはボタンの aria-label と同じ文言（読み上げには二重に伝えない）
    expect(screen.getByText("高橋 みゆき、佐藤 直樹 他 3 人が 👍 を付けました")).toBeInTheDocument();
  });

  it("「＋」は、付けられる人にだけ出す", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const { rerender } = render(<MessageReactions reactions={[reaction()]} />);

    // 参加していない public ルームでは投稿できないので付けられない（ADR 0044 決定 6）
    expect(screen.queryByRole("button", { name: "リアクションを追加" })).not.toBeInTheDocument();

    rerender(<MessageReactions reactions={[reaction()]} onAdd={onAdd} />);
    await user.click(screen.getByRole("button", { name: "リアクションを追加" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("1 件も付いていなくて足せもしないなら、行ごと出さない", () => {
    const { container } = render(<MessageReactions reactions={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
