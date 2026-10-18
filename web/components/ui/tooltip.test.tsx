import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tooltip } from "./tooltip";

describe("Tooltip", () => {
  it("名前はホバーで出し、読み上げには重ねない（ボタンの aria-label で伝える）", () => {
    render(
      <Tooltip label="スレッドで返信する">
        <button type="button" aria-label="スレッドで返信する" />
      </Tooltip>,
    );

    const tip = screen.getByText("スレッドで返信する");
    expect(tip).toHaveAttribute("aria-hidden", "true");
    expect(tip).toHaveClass("hidden", "group-hover/tooltip:block");
    // 読み上げで見えるのはボタンだけ
    expect(screen.getByRole("button", { name: "スレッドで返信する" })).toBeInTheDocument();
  });

  it("force で固定して出す", () => {
    render(
      <Tooltip label="その他の操作" force>
        <button type="button" />
      </Tooltip>,
    );

    expect(screen.getByText("その他の操作")).toHaveClass("block");
    expect(screen.getByText("その他の操作")).not.toHaveClass("hidden");
  });

  it("開いたパネルと重なるときは出さない", () => {
    render(
      <Tooltip label="その他の操作" suppressed force>
        <button type="button" />
      </Tooltip>,
    );

    expect(screen.queryByText("その他の操作")).not.toBeInTheDocument();
  });
});
