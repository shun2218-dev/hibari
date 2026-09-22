import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "./switch";

describe("Switch", () => {
  it.each([true, false])("オン・オフを switch の状態として読み上げる（%s）", (checked) => {
    render(<Switch label="未読メッセージ" checked={checked} />);

    expect(screen.getByRole("switch", { name: "未読メッセージ" })).toHaveAttribute("aria-checked", String(checked));
  });

  it("押すと反対の値で onChange を呼ぶ", async () => {
    const onChange = vi.fn();
    render(<Switch label="未読メッセージ" checked={false} onChange={onChange} />);

    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
