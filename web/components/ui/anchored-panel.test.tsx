import { createRef } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AnchoredPanel } from "./anchored-panel";

/** アンカー（メッセージの行に相当）と、その中に置いたボタンつきでパネルを描く。 */
function renderPanel(onDismiss?: () => void) {
  const anchorRef = createRef<HTMLElement>();
  render(
    <>
      <article ref={anchorRef} aria-label="行">
        <button type="button">開くボタン</button>
      </article>
      <button type="button">外のボタン</button>
      <AnchoredPanel anchorRef={anchorRef} label="パネル" onDismiss={onDismiss}>
        <button type="button">中のボタン</button>
      </AnchoredPanel>
    </>,
  );
}

describe("AnchoredPanel", () => {
  it("body の直下に出す（transform の当たった祖先の影響を受けないように）", () => {
    renderPanel();

    expect(screen.getByRole("dialog", { name: "パネル" }).parentElement).toBe(document.body);
  });

  it("外を押すと閉じる", async () => {
    const onDismiss = vi.fn();
    renderPanel(onDismiss);

    await userEvent.click(screen.getByRole("button", { name: "外のボタン" }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("中を押しても閉じない", async () => {
    const onDismiss = vi.fn();
    renderPanel(onDismiss);

    await userEvent.click(screen.getByRole("button", { name: "中のボタン" }));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("アンカーの中を押しても閉じない（開いたボタンを押し直したときに開き直さないため）", async () => {
    const onDismiss = vi.fn();
    renderPanel(onDismiss);

    await userEvent.click(screen.getByRole("button", { name: "開くボタン" }));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("Esc で閉じる", async () => {
    const onDismiss = vi.fn();
    renderPanel(onDismiss);

    await userEvent.keyboard("{Escape}");

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("onDismiss を渡さなければ、何も起きない", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "外のボタン" }));

    expect(screen.getByRole("dialog", { name: "パネル" })).toBeInTheDocument();
  });
});
