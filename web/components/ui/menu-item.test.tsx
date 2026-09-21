import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TrashIcon } from "./icons";
import { MenuItem } from "./menu-item";

describe("MenuItem", () => {
  it("文字の前にアイコンを置き、名前は文字だけにする（アイコンは読み上げない）", async () => {
    const onClick = vi.fn();
    render(
      <MenuItem icon={TrashIcon} onClick={onClick} danger>
        メッセージを削除
      </MenuItem>,
    );

    const item = screen.getByRole("button", { name: "メッセージを削除" });
    expect(item.querySelector("svg")).not.toBeNull();
    expect(item).toHaveClass("text-danger");
    await userEvent.click(item);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("アイコンがなくても、文字の頭をそろえる場所を取る", () => {
    render(<MenuItem>設定</MenuItem>);

    const slot = screen.getByRole("button", { name: "設定" }).firstElementChild;
    expect(slot).toHaveClass("w-4");
    expect(slot?.querySelector("svg")).toBeNull();
  });
});
