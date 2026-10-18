import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Popover } from "./popover";

/** 開くボタンとメニューと、外の要素を並べる。開閉の状態はここで持つ（アプリと同じ形）。 */
function Harness({ onToggle }: { onToggle?: () => void }) {
  const [open, setOpen] = useState(true);
  const toggle = () => {
    onToggle?.();
    setOpen((v) => !v);
  };
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={toggle}>
        その他の操作
      </button>
      <p>外の文字</p>
      {open && (
        <Popover label="メニュー" onDismiss={() => setOpen(false)}>
          <button type="button">中の操作</button>
        </Popover>
      )}
    </div>
  );
}

describe("Popover の外を押す・Esc で閉じる（アプリで共通の振る舞い）", () => {
  it("外を押すと閉じる", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByText("外の文字"));

    expect(screen.queryByRole("dialog", { name: "メニュー" })).not.toBeInTheDocument();
  });

  it("中を押しても閉じない", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "中の操作" }));

    expect(screen.getByRole("dialog", { name: "メニュー" })).toBeInTheDocument();
  });

  it("Esc で閉じる", async () => {
    render(<Harness />);

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "メニュー" })).not.toBeInTheDocument();
  });

  it("開いているボタンを押すと、ボタン自身が閉じる（外として閉じてから開き直さない）", async () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);

    await userEvent.click(screen.getByRole("button", { name: "その他の操作" }));

    expect(screen.queryByRole("dialog", { name: "メニュー" })).not.toBeInTheDocument();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("onDismiss を渡さなければ閉じない（story で開いた状態を描くとき）", async () => {
    render(
      <div>
        <p>外の文字</p>
        <Popover label="メニュー">中身</Popover>
      </div>,
    );

    await userEvent.click(screen.getByText("外の文字"));

    expect(screen.getByRole("dialog", { name: "メニュー" })).toBeInTheDocument();
  });
});
