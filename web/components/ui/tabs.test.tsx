import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Tabs } from "./tabs";

const items = [
  { value: "a", label: "一つ目", count: 3 },
  { value: "b", label: "二つ目" },
  { value: "c", label: "三つ目" },
] as const;

describe("Tabs", () => {
  it("選んでいるタブだけを選択中にし、Tab キーで止まるのもそのタブだけにする", () => {
    render(<Tabs label="タブ" items={items} value="b" />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("件数を渡したタブにだけ件数を出す", () => {
    render(<Tabs label="タブ" items={items} value="a" />);

    expect(screen.getByRole("tab", { name: "一つ目3" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "二つ目" })).toBeInTheDocument();
  });

  it("押したタブの値で onChange を呼ぶ", async () => {
    const onChange = vi.fn();
    render(<Tabs label="タブ" items={items} value="a" onChange={onChange} />);

    await userEvent.click(screen.getByRole("tab", { name: "三つ目" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it.each([
    { key: "ArrowRight", value: "a", next: "b" },
    { key: "ArrowLeft", value: "a", next: "c" },
    { key: "ArrowRight", value: "c", next: "a" },
  ])("$key で隣のタブを選ぶ（端では反対の端へ回る。$value → $next）", ({ key, value, next }) => {
    const onChange = vi.fn();
    render(<Tabs label="タブ" items={items} value={value} onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("tablist"), { key });
    expect(onChange).toHaveBeenCalledWith(next);
  });
});
