import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppearanceSettings } from "./appearance-settings";

describe("AppearanceSettings", () => {
  it("reflects and changes the theme", async () => {
    const onThemeChange = vi.fn();
    render(<AppearanceSettings theme="light" density="comfortable" onThemeChange={onThemeChange} />);

    expect(screen.getByRole("radio", { name: /ライト/ })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: /ダーク/ }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });
});
