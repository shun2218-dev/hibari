import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppearanceSettings, type DeviceView, DevicesSettings } from "./settings-sections";

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
