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

  it("選んでいるタブを、並びを包む要素の中だけで見える位置へ寄せる（ADR 0058）", () => {
    // jsdom は配置を計算しないので、包む要素（幅 100）と各タブ（幅 60 ずつ横に並ぶ）の位置を与える
    const rect = (left: number, width: number) => ({ left, right: left + width, top: 0, bottom: 0, width, height: 0, x: left, y: 0 }) as DOMRect;
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.getAttribute("role") === "tab") {
        const index = ["a", "b", "c"].indexOf(this.getAttribute("data-value")!);
        const scrollLeft = this.closest("[data-testid=box]")!.scrollLeft;
        return rect(index * 60 - scrollLeft, 60);
      }
      return rect(0, 100);
    });
    try {
      const outer = document.createElement("div");
      document.body.append(outer);
      const { rerender } = render(
        <div data-testid="box">
          <Tabs label="タブ" items={items} value="a" />
        </div>,
        { container: outer },
      );
      const box = screen.getByTestId("box");
      expect(box.scrollLeft).toBe(0);

      rerender(
        <div data-testid="box">
          <Tabs label="タブ" items={items} value="c" />
        </div>,
      );
      // 三つ目（120〜180）の右端が 100 に来るまで寄せる
      expect(box.scrollLeft).toBe(80);
      // 外側の要素は動かさない（scrollIntoView が画面の外枠まで動かして、モバイルで崩れたため）
      expect(outer.scrollLeft).toBe(0);
    } finally {
      spy.mockRestore();
    }
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
