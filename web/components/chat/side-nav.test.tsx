import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("SideNavRail のホバー（ADR 0058 の追記）", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const previews = {
    dms: (
      <div>
        <p>DM の一覧</p>
        <button type="button">未読メッセージ</button>
        <Link href="/w/w1/r/d1">佐藤 直樹</Link>
      </div>
    ),
    activity: <p>アクティビティの一覧</p>,
    later: <p>後での一覧</p>,
  };

  function renderRail(current: "home" | "dms" | "activity" | "later" = "home") {
    return render(<SideNavRail items={items} current={current} workspace={<span />} account={<span />} previews={previews} />);
  }

  function hover(name: string) {
    fireEvent.mouseEnter(screen.getByRole("link", { name: new RegExp(name) }).closest("li")!);
    act(() => vi.advanceTimersByTime(200));
  }

  it("ポインタを乗せると、そのメニューの一覧を重ねて出し、外すと閉じる", () => {
    renderRail();

    hover("アクティビティ");
    expect(screen.getByText("アクティビティの一覧")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole("navigation", { name: "メニュー" }));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByText("アクティビティの一覧")).not.toBeInTheDocument();
  });

  it("今いるメニューと、中身のないホームでは出さない", () => {
    renderRail("activity");

    hover("アクティビティ");
    expect(screen.queryByText("アクティビティの一覧")).not.toBeInTheDocument();
    hover("ホーム");
    expect(screen.queryByText(/の一覧$/)).not.toBeInTheDocument();
  });

  it("重ねた一覧の上に移っても閉じず、1 件（リンク）を押したら閉じる", () => {
    renderRail();

    hover("DM");
    const panel = screen.getByText("DM の一覧").closest("div")!.parentElement!;
    // メニューからパネルへ動かす間に閉じる予約が入っても、パネルに入れば取り消す
    fireEvent.mouseEnter(screen.getByRole("link", { name: /後で/ }).closest("li")!);
    fireEvent.mouseEnter(panel);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText("DM の一覧")).toBeInTheDocument();

    // スイッチなど、リンクでないものを押しても閉じない
    fireEvent.click(screen.getByRole("button", { name: "未読メッセージ" }));
    expect(screen.getByText("DM の一覧")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "佐藤 直樹" }));
    expect(screen.queryByText("DM の一覧")).not.toBeInTheDocument();
  });

  it("押したら重ねた一覧を閉じる（サイドバーが同じ一覧に切り替わる）", () => {
    renderRail();

    hover("後で");
    fireEvent.click(screen.getByRole("link", { name: /後で/ }));
    expect(screen.queryByText("後での一覧")).not.toBeInTheDocument();
  });
});
