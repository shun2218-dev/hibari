import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useAutosizeTextarea } from "./use-autosize-textarea";

/**
 * jsdom はレイアウトを持たず、高さはすべて 0 になる。中身の高さ（scrollHeight）と枠線のぶん
 * （offsetHeight - clientHeight）を差し替えて、入れ直す高さの計算だけを見る。
 */
function stubHeights({ scrollHeight, offsetHeight = 0, clientHeight = 0 }: { scrollHeight: number; offsetHeight?: number; clientHeight?: number }) {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(offsetHeight);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
}

function Subject({ value }: { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextarea(ref, value);
  return <textarea ref={ref} aria-label="本文" value={value} readOnly />;
}

describe("useAutosizeTextarea", () => {
  it("puts the content height back into the element", () => {
    stubHeights({ scrollHeight: 96 });
    const { getByRole } = render(<Subject value="1 行目\n2 行目\n3 行目" />);

    expect(getByRole("textbox", { name: "本文" })).toHaveStyle({ height: "96px" });
  });

  it("adds the borders so the last line does not get cut off", () => {
    // 枠線が上下 1px ずつ。box-sizing: border-box なので、その分を足さないと中身が 2px 足りない
    stubHeights({ scrollHeight: 96, offsetHeight: 42, clientHeight: 40 });
    const { getByRole } = render(<Subject value="本文" />);

    expect(getByRole("textbox", { name: "本文" })).toHaveStyle({ height: "98px" });
  });

  it("shrinks again when the text gets shorter", () => {
    const scrollHeight = vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(96);
    const { getByRole, rerender } = render(<Subject value="1 行目\n2 行目\n3 行目" />);
    const textarea = getByRole("textbox", { name: "本文" });
    expect(textarea).toHaveStyle({ height: "96px" });

    // 縮むかどうかは「測る前に height: auto へ戻したか」で決まる。戻していれば 1 行ぶんが読める
    scrollHeight.mockImplementation(function (this: HTMLElement) {
      return this.style.height === "auto" ? 32 : 96;
    });
    rerender(<Subject value="1 行目" />);

    expect(textarea).toHaveStyle({ height: "32px" });
  });

  it("measures again when the element gets narrower", () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    // 幅が変わるたびに折り返しが増える（= 中身が高くなる）状況を作る
    let width = 400;
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => width);
    const scrollHeight = vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(48);
    const { getByRole } = render(<Subject value="折り返す長さの本文" />);
    expect(getByRole("textbox", { name: "本文" })).toHaveStyle({ height: "48px" });

    scrollHeight.mockReturnValue(96);
    // 高さだけが変わったとき（自分で入れた分）は測り直さない
    observers[0]();
    expect(getByRole("textbox", { name: "本文" })).toHaveStyle({ height: "48px" });

    width = 200;
    observers[0]();
    expect(getByRole("textbox", { name: "本文" })).toHaveStyle({ height: "96px" });
  });

  it("leaves the height alone where it cannot be measured", () => {
    // jsdom の既定（すべて 0）。0px を入れて潰してしまわないこと
    const { getByRole } = render(<Subject value="本文" />);

    expect(getByRole("textbox", { name: "本文" }).style.height).toBe("");
  });
});
