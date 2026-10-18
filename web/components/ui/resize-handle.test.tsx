import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PANE_STORAGE_KEY, type PaneId, paneVar, resetPaneSizesForTest } from "@/lib/pane-size";

import { ResizeHandle } from "./resize-handle";

// jsdom はレイアウトを持たないので、globals.css の clamp を測れない。
// `--pane-sidebar` を [MIN, MAX] に丸めて返すだけの「描画」を置き換える。
const MIN = 200;
const MAX = 480;
const DEFAULT = 288;

function stubLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => {
    const raw = document.documentElement.style.getPropertyValue(paneVar("sidebar"));
    const value = raw === "" ? DEFAULT : Number.parseFloat(raw);
    return { width: Math.min(Math.max(value, MIN), MAX), height: 0 } as DOMRect;
  });
}

function Subject({ pane = "sidebar", grow = "right" }: { pane?: PaneId; grow?: "right" | "left" | "up" }) {
  const pane_ = useRef<HTMLDivElement>(null);
  return (
    <div ref={pane_}>
      <ResizeHandle pane={pane} grow={grow} measure={pane_} />
    </div>
  );
}

function handle() {
  return screen.getByRole("separator", { name: "サイドバーの幅" });
}

/** 押す → 動かす → 離す。PointerEvent の無い jsdom でも動くように、素の Event に座標を足して送る。 */
function drag(el: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(el, { button: 0, clientX: from, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(document, { clientX: to, clientY: 0, pointerId: 1 });
  fireEvent.pointerUp(document, { pointerId: 1 });
}

beforeEach(() => {
  stubLayout();
  // jsdom は Pointer Events を持たないので、React が呼ぶぶんだけ生やす
  Element.prototype.setPointerCapture = () => {};
});

afterEach(() => {
  resetPaneSizesForTest();
  localStorage.clear();
});

describe("ResizeHandle", () => {
  it("resizes while dragging and remembers it once the drag is over", () => {
    render(<Subject />);

    fireEvent.pointerDown(handle(), { button: 0, clientX: 288, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 348, clientY: 0, pointerId: 1 });

    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("348px");
    // 動かしている間は書かない（1 回のドラッグで何十回も localStorage に書かないため）
    expect(localStorage.getItem(PANE_STORAGE_KEY)).toBeNull();

    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(JSON.parse(localStorage.getItem(PANE_STORAGE_KEY)!)).toEqual({ sidebar: 348 });
  });

  it("pulls the other way for a pane that grows to the left", () => {
    render(<Subject grow="left" />);

    drag(handle(), 288, 238);

    // 境目を左に 50px 動かした = 右のパネルは 50px 広がる
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("338px");
  });

  it("stops at the limits the css decides", () => {
    render(<Subject />);

    drag(handle(), 288, 900);
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe(`${MAX}px`);

    drag(handle(), MAX, 0);
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe(`${MIN}px`);
  });

  it("ignores anything but the main button", () => {
    render(<Subject />);

    fireEvent.pointerDown(handle(), { button: 2, clientX: 288, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 400, clientY: 0, pointerId: 1 });

    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("");
  });

  it("moves with the arrow keys and jumps to the limits with Home and End", async () => {
    render(<Subject />);
    handle().focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("304px");

    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("240px");

    await userEvent.keyboard("{End}");
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe(`${MAX}px`);

    await userEvent.keyboard("{Home}");
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe(`${MIN}px`);
  });

  it("goes back to the default on a double click or Enter", async () => {
    render(<Subject />);

    drag(handle(), 288, 348);
    await userEvent.dblClick(handle());
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("");

    drag(handle(), 288, 348);
    handle().focus();
    await userEvent.keyboard("{Enter}");
    expect(document.documentElement.style.getPropertyValue("--pane-sidebar")).toBe("");
  });

  it("tells assistive tech the value and the range it may take", () => {
    render(<Subject />);

    expect(handle()).toHaveAttribute("aria-orientation", "vertical");
    expect(handle()).toHaveAttribute("aria-valuenow", String(DEFAULT));
    expect(handle()).toHaveAttribute("aria-valuemin", String(MIN));
    expect(handle()).toHaveAttribute("aria-valuemax", String(MAX));
    expect(handle()).toHaveAttribute("aria-valuetext", `${DEFAULT} ピクセル`);
  });
});
