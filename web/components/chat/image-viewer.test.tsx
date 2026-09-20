import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ImageViewer } from "./image-viewer";

const images = [
  { id: "a1", fileName: "改訂 01.png", url: "https://example/a1" },
  { id: "a2", fileName: "改訂 02.png", url: "https://example/a2" },
  { id: "a3", fileName: "改訂 03.png", url: "https://example/a3" },
];

function viewer(props: Partial<Parameters<typeof ImageViewer>[0]> = {}) {
  return <ImageViewer images={images} index={1} onMove={vi.fn()} onClose={vi.fn()} {...props} />;
}

describe("ImageViewer（ADR 0045）", () => {
  it("開いている画像と、そのメッセージの中での位置を出す", () => {
    render(viewer());

    expect(screen.getByRole("img", { name: "改訂 02.png" })).toHaveAttribute("src", "https://example/a2");
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("矢印とキーボードで前後に送る", async () => {
    const onMove = vi.fn();
    render(viewer({ onMove }));

    await userEvent.click(screen.getByRole("button", { name: "次の画像" }));
    expect(onMove).toHaveBeenCalledWith(2);

    await userEvent.click(screen.getByRole("button", { name: "前の画像" }));
    expect(onMove).toHaveBeenCalledWith(0);

    await userEvent.keyboard("{ArrowRight}");
    expect(onMove).toHaveBeenLastCalledWith(2);

    await userEvent.keyboard("{ArrowLeft}");
    expect(onMove).toHaveBeenLastCalledWith(0);
  });

  it("端では矢印を出さず、キーでも動かない（巻き戻さない）", async () => {
    const onMove = vi.fn();
    const { rerender } = render(viewer({ index: 0, onMove }));

    // 先頭では「前の画像」を出さない。押せないボタンを残すと、押せるものと見分けがつかない
    expect(screen.queryByRole("button", { name: "前の画像" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次の画像" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onMove).not.toHaveBeenCalled();

    rerender(viewer({ index: images.length - 1, onMove }));
    expect(screen.queryByRole("button", { name: "次の画像" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前の画像" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowRight}");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("1 枚しかなければ、送る導線を出さない", () => {
    render(viewer({ images: [images[0]], index: 0 }));

    expect(screen.queryByRole("button", { name: "次の画像" })).not.toBeInTheDocument();
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
  });

  it("× と Esc で閉じる", async () => {
    const onClose = vi.fn();
    render(viewer({ onClose }));

    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledOnce();

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ダウンロードは、開いている画像の ID で呼ぶ", async () => {
    const onDownload = vi.fn();
    render(viewer({ onDownload }));

    await userEvent.click(screen.getByRole("button", { name: "ダウンロード" }));

    expect(onDownload).toHaveBeenCalledWith("a2");
  });

  it("削除は、消せる人のときだけ出す（ADR 0045 決定 9）", async () => {
    const onDelete = vi.fn();
    const { rerender } = render(viewer());

    expect(screen.queryByRole("button", { name: "ファイルを削除" })).not.toBeInTheDocument();

    rerender(viewer({ onDelete }));
    await userEvent.click(screen.getByRole("button", { name: "ファイルを削除" }));

    expect(onDelete).toHaveBeenCalledWith("a2");
  });

  it("開いたら中にフォーカスを移し、閉じたら元の要素に戻す", async () => {
    render(
      <>
        <button type="button">もとの画像</button>
        <div id="viewer" />
      </>,
    );
    const opener = screen.getByRole("button", { name: "もとの画像" });
    opener.focus();

    const { unmount } = render(viewer());
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "改訂 02.png の拡大表示" }));

    unmount();
    expect(document.activeElement).toBe(opener);
  });
});
