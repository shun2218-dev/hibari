import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsLayout, SettingsMobileMenu } from "./settings-layout";

describe("設定のナビ", () => {
  it("行き先のある項目だけを並べる（ページをつなぐまで、行き先のないリンクを出さない）", () => {
    render(
      <SettingsLayout section="profile" hrefs={{ profile: "/settings/profile", appearance: "/settings/appearance" }} backHref="/settings" chatHref="/">
        <p>中身</p>
      </SettingsLayout>,
    );

    const nav = screen.getByRole("navigation", { name: "設定" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["プロフィール", "外観"]);
  });

  it("通知はプロフィールの次に置く", () => {
    render(
      <SettingsMobileMenu
        hrefs={{ profile: "/p", notifications: "/n", devices: "/d", appearance: "/a" }}
        chatHref="/"
      />,
    );

    expect(within(screen.getByRole("navigation", { name: "設定" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["プロフィール", "通知", "ログイン中のデバイス", "外観"]);
  });
});
