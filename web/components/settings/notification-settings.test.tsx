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

describe("NotificationSettings のプッシュ通知（ADR 0069）", () => {
  const workspaces = [{ id: "w1", name: "hibari 開発", level: "mentions" as const }];
  const current = { id: "s1", kind: "browser" as const, name: "Chrome · macOS", enabledLabel: "10月19日に有効にしました", current: true };
  const other = {
    id: "s2",
    kind: "phone" as const,
    name: "Safari · iPhone（ホーム画面）",
    enabledLabel: "10月19日に有効にしました",
    current: false,
  };

  it("プッシュを渡さなければ、これまでのデスクトップ通知のカードのまま（決定 9）", () => {
    render(<NotificationSettings workspaces={workspaces} browser={{ permission: "granted", sound: true }} />);

    expect(screen.getByText("デスクトップ通知")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText(/デスクトップ通知を出すときに短い音を鳴らす/)).toBeInTheDocument();
  });

  it.each([
    { state: "on" as const, checked: true, disabled: false, text: /有効です。hibari を閉じていても/ },
    { state: "off" as const, checked: false, disabled: false, text: /オフです。有効にすると/ },
    { state: "requesting" as const, checked: true, disabled: true, text: /ブラウザの確認で「許可」を選んでください/ },
    { state: "failed" as const, checked: false, disabled: false, text: /通知を受け取る準備ができませんでした/ },
  ])("$state はスイッチで切り替えられる状態として出す", ({ state, checked, disabled, text }) => {
    render(<NotificationSettings workspaces={workspaces} browser={{ permission: "granted", sound: true, push: { state } }} />);

    const toggle = screen.getByRole("switch", { name: "プッシュ通知" });
    expect(toggle).toHaveAttribute("aria-checked", String(checked));
    if (disabled) expect(toggle).toBeDisabled();
    else expect(toggle).toBeEnabled();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText("デスクトップ通知")).not.toBeInTheDocument();
  });

  it("失敗の説明は danger の色にする", () => {
    render(<NotificationSettings workspaces={workspaces} browser={{ permission: "granted", sound: true, push: { state: "failed" } }} />);

    expect(screen.getByText(/通知を受け取る準備ができませんでした/)).toHaveClass("text-danger");
  });

  it.each([
    { state: "denied" as const, text: /アドレスバーの左のアイコンから/ },
    { state: "unsupported" as const, text: /このブラウザはプッシュ通知に対応していません/ },
    { state: "install" as const, text: /ホーム画面に追加すると通知を受け取れます/ },
  ])("$state はスイッチを出さない", ({ state, text }) => {
    render(<NotificationSettings workspaces={workspaces} browser={{ permission: "default", sound: true, push: { state } }} />);

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("スイッチで有効にでき、ホーム画面にないときは追加のしかたを開ける", async () => {
    const onEnabledChange = vi.fn();
    const onShowInstallGuide = vi.fn();
    const { rerender } = render(
      <NotificationSettings workspaces={workspaces} browser={{ permission: "default", sound: true, push: { state: "off", onEnabledChange } }} />,
    );
    await userEvent.click(screen.getByRole("switch", { name: "プッシュ通知" }));
    expect(onEnabledChange).toHaveBeenCalledWith(true);

    rerender(
      <NotificationSettings
        workspaces={workspaces}
        browser={{ permission: "default", sound: true, push: { state: "install", onShowInstallGuide } }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "追加のしかたを見る" }));
    expect(onShowInstallGuide).toHaveBeenCalledOnce();
  });

  it("通知音はタブの通知だけに効くと書く（決定 2）", () => {
    render(<NotificationSettings workspaces={workspaces} browser={{ permission: "granted", sound: true, push: { state: "on" } }} />);

    expect(screen.getByText("タブの通知を出すときに短い音を鳴らす。この端末だけの設定")).toBeInTheDocument();
  });

  it("通知を受け取る端末を並べ、ほかの端末だけ止められる", async () => {
    const onStopDevice = vi.fn();
    render(
      <NotificationSettings
        workspaces={workspaces}
        browser={{ permission: "granted", sound: true, push: { state: "on", devices: [current, other], onStopDevice } }}
      />,
    );

    const section = screen.getByRole("group", { name: "通知を受け取る端末" });
    const rows = within(section).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("このデバイス");
    expect(rows[0]).toHaveClass("bg-surface-muted");
    expect(within(rows[0]).queryByRole("button", { name: "停止する" })).not.toBeInTheDocument();

    await userEvent.click(within(rows[1]).getByRole("button", { name: "停止する" }));
    expect(onStopDevice).toHaveBeenCalledWith("s2");
  });

  it("端末が 1 つもなければ、その節を出さない", () => {
    render(
      <NotificationSettings workspaces={workspaces} browser={{ permission: "default", sound: true, push: { state: "off", devices: [] } }} />,
    );

    expect(screen.queryByRole("group", { name: "通知を受け取る端末" })).not.toBeInTheDocument();
  });
});
