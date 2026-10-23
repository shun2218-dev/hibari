import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HomeScreenSheet } from "./home-screen-sheet";

describe("HomeScreenSheet（ADR 0069 決定 1）", () => {
  it("Safari で押すものを順に 3 つ示し、「閉じる」で閉じる", async () => {
    const onClose = vi.fn();
    render(<HomeScreenSheet onClose={onClose} />);

    const sheet = screen.getByRole("dialog", { name: "ホーム画面に追加する" });
    const steps = within(sheet).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "1画面の下の共有を押す",
      "2ホーム画面に追加を選ぶ",
      "3ホーム画面の hibari を開き、設定の「通知」でプッシュ通知を有効にする",
    ]);

    await userEvent.click(within(sheet).getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("開いたらシートへフォーカスを移し、閉じたら元の要素に戻す。Escape でも閉じる", async () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(<HomeScreenSheet onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "ホーム画面に追加する" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
