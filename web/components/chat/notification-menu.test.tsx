import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NotificationMenu } from "./notification-menu";

describe("NotificationMenu", () => {
  it("チャンネルでは、通知する内容を選べる。null は全体の設定に従う（ADR 0055 決定 1）", async () => {
    const user = userEvent.setup();
    const onLevelChange = vi.fn();
    render(<NotificationMenu kind="public" level={null} defaultLevelLabel="メンションと DM" mute={null} onLevelChange={onLevelChange} />);

    expect(screen.getByRole("button", { name: /全体の設定に従う/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /全体の設定に従う/ })).toHaveTextContent("いまは「メンションと DM」");
    expect(screen.getByRole("button", { name: "すべての新しい投稿" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "メンションのみ" }));
    expect(onLevelChange).toHaveBeenCalledWith("mentions");
    await user.click(screen.getByRole("button", { name: /全体の設定に従う/ }));
    expect(onLevelChange).toHaveBeenLastCalledWith(null);
  });

  it("DM ではミュートだけを出す（DM の通知はチャンネルごとに上書きしない）", () => {
    render(<NotificationMenu kind="dm" level={null} defaultLevelLabel="メンションと DM" mute={null} />);

    expect(screen.queryByText("通知する内容")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ミュートする" })).toBeInTheDocument();
  });

  it("ミュートと、一時的なミュート（1 時間・明日まで）ができる", async () => {
    const user = userEvent.setup();
    const onMute = vi.fn();
    const onMuteTemporarily = vi.fn();
    render(
      <NotificationMenu
        kind="public"
        level={null}
        defaultLevelLabel="メンションと DM"
        mute={null}
        onMute={onMute}
        onMuteTemporarily={onMuteTemporarily}
      />,
    );

    await user.click(screen.getByRole("button", { name: "チャンネルをミュートする" }));
    await user.click(screen.getByRole("button", { name: "1 時間" }));
    await user.click(screen.getByRole("button", { name: "明日まで" }));

    expect(onMute).toHaveBeenCalledOnce();
    expect(onMuteTemporarily.mock.calls).toEqual([["hour"], ["tomorrow"]]);
  });

  it("ミュート中は、いつまでかと解除を出す", async () => {
    const user = userEvent.setup();
    const onUnmute = vi.fn();
    const { rerender } = render(
      <NotificationMenu
        kind="public"
        level="all"
        defaultLevelLabel="メンションと DM"
        mute={{ untilLabel: "今日 18:30 まで" }}
        onUnmute={onUnmute}
      />,
    );

    expect(screen.getByText("今日 18:30 までミュート中")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "1 時間" })).not.toBeInTheDocument();
    // ミュートしていても通知する内容は選べる（解除したときに戻る設定）
    expect(screen.getByRole("button", { name: "すべての新しい投稿" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "ミュートを解除する" }));
    expect(onUnmute).toHaveBeenCalledOnce();

    rerender(<NotificationMenu kind="public" level="all" defaultLevelLabel="メンションと DM" mute={{}} />);
    expect(screen.getByText("ミュート中")).toBeInTheDocument();
  });
});
