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
