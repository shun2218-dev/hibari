import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NotificationSettings } from "./notification-settings";

describe("NotificationSettings", () => {
  it("ワークスペースごとに通知する内容を選べる（ADR 0055 決定 2）", async () => {
    const onLevelChange = vi.fn();
    render(
      <NotificationSettings
        workspaces={[
          { id: "w1", name: "hibari 開発", level: "mentions" },
          { id: "w2", name: "個人メモ", level: "all" },
        ]}
        onLevelChange={onLevelChange}
      />,
    );

    const dev = screen.getByRole("group", { name: "hibari 開発" });
    const memo = screen.getByRole("group", { name: "個人メモ" });
    // 節ごとに別のまとまりなので、どちらも選んだ値が残る
    expect(within(dev).getByRole("radio", { name: /メンションと DM/ })).toBeChecked();
    expect(within(memo).getByRole("radio", { name: /すべて/ })).toBeChecked();

    await userEvent.click(within(memo).getByRole("radio", { name: /なし/ }));
    expect(onLevelChange).toHaveBeenCalledWith("w2", "none");
  });
});

describe("NotificationSettings のこのブラウザ（ADR 0057）", () => {
  const workspaces = [{ id: "w1", name: "hibari 開発", level: "mentions" as const }];

  it("まだ許可していなければ「有効にする」を出し、通知音は許可するまで選べない", async () => {
    const onRequestPermission = vi.fn();
    render(
      <NotificationSettings workspaces={workspaces} browser={{ permission: "default", onRequestPermission, sound: true }} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "有効にする" }));
    expect(onRequestPermission).toHaveBeenCalledOnce();
    expect(screen.getByRole("checkbox", { name: /通知音を鳴らす/ })).toBeDisabled();
  });

  it("拒否されていたら、ブラウザの設定から許可するよう書き、求めるボタンは出さない", () => {
    render(<NotificationSettings workspaces={workspaces} browser={{ permission: "denied", sound: true }} />);

    expect(screen.getByText(/ブラウザで通知が拒否されています/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "有効にする" })).not.toBeInTheDocument();
  });

  it("許可されていれば、通知音を切り替えられる", async () => {
    const onSoundChange = vi.fn();
    render(<NotificationSettings workspaces={workspaces} browser={{ permission: "granted", sound: true, onSoundChange }} />);

    await userEvent.click(screen.getByRole("checkbox", { name: /通知音を鳴らす/ }));
    expect(onSoundChange).toHaveBeenCalledWith(false);
  });
});
