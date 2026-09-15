import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("renders nothing while closed", () => {
    render(<Dialog open={false} title="タイトル" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus into the dialog and back when it closes", () => {
    const { rerender } = render(
      <>
        <button type="button">開く</button>
        <Dialog open={false} title="ワークスペースを作成" />
      </>,
    );
    const opener = screen.getByRole("button", { name: "開く" });
    opener.focus();

    rerender(
      <>
        <button type="button">開く</button>
        <Dialog open title="ワークスペースを作成" description="あとから名前は変更できます" />
      </>,
    );
    const dialog = screen.getByRole("dialog", { name: "ワークスペースを作成" });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveAccessibleDescription("あとから名前は変更できます");

    rerender(
      <>
        <button type="button">開く</button>
        <Dialog open={false} title="ワークスペースを作成" />
      </>,
    );
    expect(opener).toHaveFocus();
  });

  it("closes on Escape and on the backdrop", async () => {
    const onClose = vi.fn();
    render(<Dialog open title="確認" onClose={onClose} />);

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("dialog").parentElement!);

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close when clicking inside the panel", async () => {
    const onClose = vi.fn();
    render(<Dialog open title="確認" onClose={onClose} />);

    await userEvent.click(screen.getByRole("heading", { name: "確認" }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
