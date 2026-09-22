import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SideNavBar, type SideNavItems, SideNavRail } from "./side-nav";

const items: SideNavItems = {
  home: { href: "/w/w1" },
  dms: { href: "/w/w1?side=dms", badge: 2 },
  activity: { href: "/w/w1?side=activity", badge: 0 },
  later: { href: "/w/w1?side=later" },
};

describe("SideNavRail", () => {
  it("lists ホーム・DM・アクティビティ・後で in order and marks the current one", () => {
    render(<SideNavRail items={items} current="activity" workspace={<span />} account={<span />} />);

    const nav = screen.getByRole("navigation", { name: "メニュー" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["ホーム", "2DM", "アクティビティ", "後で"]);
    expect(within(nav).getByRole("link", { current: "page" })).toHaveTextContent("アクティビティ");
    expect(links[1]).toHaveAttribute("href", "/w/w1?side=dms");
  });

  it("shows a badge only when there is something to know about", () => {
    render(<SideNavRail items={items} current="home" workspace={<span />} account={<span />} />);

    // DM は未読の会話の数。0 のアクティビティと、数を渡さないホーム・後でには出さない
    expect(screen.getByLabelText("未読 2 件")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^未読/)).toHaveLength(1);
  });

  it("places the workspace and account buttons at the top and bottom", () => {
    render(
      <SideNavRail
        items={items}
        current="home"
        workspace={<button type="button">ワークスペース</button>}
        account={<button type="button">アカウント</button>}
      />,
    );

    const buttons = within(screen.getByRole("navigation", { name: "メニュー" })).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["ワークスペース", "アカウント"]);
  });
});

describe("SideNavBar", () => {
  it("lists the same four items and marks the current one", () => {
    render(<SideNavBar items={items} current="dms" />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["ホーム", "2DM", "アクティビティ", "後で"]);
    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent("DM");
  });
});
