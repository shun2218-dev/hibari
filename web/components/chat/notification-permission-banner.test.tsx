import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NotificationPermissionBanner } from "./notification-permission-banner";

describe("NotificationPermissionBanner（ADR 0057 決定 5）", () => {
  it("押したときに許可を求め、「今はしない」で閉じられる", async () => {
    const onEnable = vi.fn();
    const onDismiss = vi.fn();
    render(<NotificationPermissionBanner onEnable={onEnable} onDismiss={onDismiss} />);

    expect(screen.getByRole("region", { name: "デスクトップ通知" })).toHaveTextContent("デスクトップ通知を有効にしますか？");
    await userEvent.click(screen.getByRole("button", { name: "有効にする" }));
    await userEvent.click(screen.getByRole("button", { name: "今はしない" }));

    expect(onEnable).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("NotificationPermissionBanner のプッシュ通知（ADR 0069）", () => {
  it("プッシュの帯は、閉じていても届くことを書き、押すと有効にする", async () => {
    const onEnable = vi.fn();
    render(<NotificationPermissionBanner kind="push" onEnable={onEnable} />);

    const banner = screen.getByRole("region", { name: "プッシュ通知" });
    expect(banner).toHaveTextContent("通知を有効にしますか？");
    expect(banner).toHaveTextContent("hibari を閉じていても、メンションと DM をこのブラウザで受け取れます");
    await userEvent.click(screen.getByRole("button", { name: "有効にする" }));
    expect(onEnable).toHaveBeenCalledOnce();
  });

  it("ホーム画面にない iPhone では、許可の代わりに追加のしかたを開く", async () => {
    const onEnable = vi.fn();
    const onShowInstallGuide = vi.fn();
    render(<NotificationPermissionBanner kind="install" onEnable={onEnable} onShowInstallGuide={onShowInstallGuide} />);

    expect(screen.getByRole("region", { name: "プッシュ通知" })).toHaveTextContent("ホーム画面に追加すると通知が届きます");
    await userEvent.click(screen.getByRole("button", { name: "追加のしかた" }));
    expect(onShowInstallGuide).toHaveBeenCalledOnce();
    expect(onEnable).not.toHaveBeenCalled();
  });
});
