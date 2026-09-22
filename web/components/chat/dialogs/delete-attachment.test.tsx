import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteAttachmentDialog } from "./delete-attachment";

describe("DeleteAttachmentDialog（ADR 0045）", () => {
  it("ファイルだけを消すときは、メッセージが残ると伝える", async () => {
    const onConfirm = vi.fn();
    render(<DeleteAttachmentDialog open fileName="改訂 02.png" onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog", { name: "ファイルを削除しますか？" })).toHaveAccessibleDescription(
      "このファイルだけを削除します。メッセージと本文は残ります。元には戻せません。",
    );
    expect(screen.getByText("改訂 02.png")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("最後の 1 枚で本文も空なら、メッセージごと消えることを先に伝える（ADR 0045 決定 8）", () => {
    render(<DeleteAttachmentDialog open alsoDeletesMessage fileName="未読バッジの候補.png" />);

    expect(screen.getByRole("dialog", { name: "メッセージごと削除しますか？" })).toHaveAccessibleDescription(
      "これがこのメッセージの最後の添付で、本文もありません。削除するとメッセージごと消えて、タイムラインからもなくなります。元には戻せません。",
    );
  });
});
