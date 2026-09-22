import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppearanceSettings, type DeviceView, DevicesSettings, NotificationSettings, ProfileSettings } from "./settings-sections";

const devices: DeviceView[] = [
  { id: "s1", kind: "browser", name: "Chrome · macOS", lastActiveLabel: "現在アクティブ", current: true },
  { id: "s2", kind: "phone", name: "hibari for iOS · iPhone 15", lastActiveLabel: "2分前", current: false },
];

describe("DevicesSettings", () => {
  it("marks this device and lets other sessions be logged out", async () => {
    const onLogout = vi.fn();
    render(<DevicesSettings devices={devices} onLogout={onLogout} />);

    const [current, other] = screen.getAllByRole("listitem");
    expect(within(current).getByText("このデバイス")).toBeInTheDocument();
    expect(within(current).queryByRole("button", { name: "ログアウト" })).not.toBeInTheDocument();

    await userEvent.click(within(other).getByRole("button", { name: "ログアウト" }));
    expect(onLogout).toHaveBeenCalledWith("s2");
  });

  it("logs out every other device at once", async () => {
    const onLogoutOthers = vi.fn();
    render(<DevicesSettings devices={devices} onLogoutOthers={onLogoutOthers} />);

    await userEvent.click(screen.getByRole("button", { name: "他のすべてのデバイスからログアウト" }));
    expect(onLogoutOthers).toHaveBeenCalledOnce();
  });
});

describe("AppearanceSettings", () => {
  it("reflects and changes the theme", async () => {
    const onThemeChange = vi.fn();
    render(<AppearanceSettings theme="light" density="comfortable" onThemeChange={onThemeChange} />);

    expect(screen.getByRole("radio", { name: /ライト/ })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: /ダーク/ }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });
});

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

describe("ProfileSettings avatar", () => {
  const user = { id: "u1", displayName: "あなた", handle: "you" };

  it("offers removal only when there is an image", async () => {
    const onRemoveImage = vi.fn();
    const { rerender } = render(<ProfileSettings user={user} onRemoveImage={onRemoveImage} />);
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();

    rerender(<ProfileSettings user={{ ...user, avatarUrl: "https://storage.test/a.png" }} onRemoveImage={onRemoveImage} />);
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(onRemoveImage).toHaveBeenCalledOnce();
  });

  it("disables changing the image while uploading", () => {
    render(<ProfileSettings user={{ ...user, avatarUrl: "https://storage.test/a.png" }} avatarState="uploading" />);

    expect(screen.getByRole("button", { name: "画像を変更" })).toBeDisabled();
    expect(screen.getByText("アップロード中…")).toBeInTheDocument();
    // アップロード中は消させない（終わってからにする）
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  });

  it("lets a failed upload be retried", async () => {
    const onRetryImage = vi.fn();
    render(<ProfileSettings user={user} avatarState="failed" onRetryImage={onRetryImage} />);

    expect(screen.getByRole("alert")).toHaveTextContent("画像をアップロードできませんでした");
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetryImage).toHaveBeenCalledOnce();
    // 失敗しても、いまのアバター（頭文字）はそのまま出す
    expect(screen.getByText("あ")).toBeInTheDocument();
  });

  it("says what can be uploaded", () => {
    render(<ProfileSettings user={user} />);

    expect(screen.getByText("PNG / JPEG / WebP、2 MB まで。正方形に切り取って表示します。")).toBeInTheDocument();
  });
});
