import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ComposerLinkPreview, LinkPreviewCard, isLargeImage } from "./link-preview-card";
import type { LinkPreviewView } from "./types";

function preview(overrides: Partial<LinkPreviewView> = {}): LinkPreviewView {
  return {
    id: "01J8ZH5K000000000000000001",
    url: "https://example.com/post/1",
    siteName: "Example",
    title: "記事のタイトル",
    description: "記事の説明",
    image: { width: 1200, height: 630, url: "https://storage.example/lp/image" },
    hasIcon: true,
    iconUrl: "https://storage.example/lp/icon",
    ...overrides,
  };
}

describe("LinkPreviewCard", () => {
  it("タイトルは本文に書かれた URL へのリンクで、別のタブに開く", () => {
    render(<LinkPreviewCard preview={preview()} />);

    const card = screen.getByRole("article", { name: "記事のタイトル のプレビュー" });
    const link = within(card).getByRole("link", { name: "記事のタイトル" });
    expect(link).toHaveAttribute("href", "https://example.com/post/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(card).getByText("記事の説明")).toBeInTheDocument();
    expect(within(card).getByText("Example")).toBeInTheDocument();
  });

  it("画像とアイコンは、取れた URL で出す", () => {
    const { container } = render(<LinkPreviewCard preview={preview()} />);

    const srcs = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    // 横長の画像は上に出るので、画像が先
    expect(srcs).toEqual(["https://storage.example/lp/image", "https://storage.example/lp/icon"]);
  });

  // ADR 0065 の追記: 横長の画像は右の枠では左右が切れるので、上に幅いっぱいで出す
  it("大きい横長の画像は、文字の上に縦横比のまま出す", () => {
    const { container } = render(<LinkPreviewCard preview={preview()} />);

    const card = screen.getByRole("article");
    expect(card).toHaveClass("flex-col");
    const frame = container.querySelector("img")!.parentElement!;
    expect(frame.style.aspectRatio).toBe("1200 / 630");
    // 画像の枠は文字（タイトル）より前にある
    expect(frame.compareDocumentPosition(within(card).getByRole("link")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("横長ではない・小さい画像は、右のサムネイルに出す", () => {
    for (const image of [
      { width: 800, height: 1200 },
      { width: 300, height: 157 },
    ]) {
      const { container, unmount } = render(<LinkPreviewCard preview={preview({ image: { ...image, url: "https://storage.example/lp/image" } })} />);
      expect(screen.getByRole("article")).not.toHaveClass("flex-col");
      expect(container.querySelector("img[src='https://storage.example/lp/image']")!.parentElement!.style.aspectRatio).toBe("");
      unmount();
    }
  });

  it("画像とアイコンの URL が取れるまでは、画像を読みに行かない", () => {
    const { container } = render(
      <LinkPreviewCard preview={preview({ image: { width: 1200, height: 630 }, iconUrl: undefined })} />,
    );

    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("画像もアイコンも説明もなければ、タイトルとサイト名だけを出す", () => {
    const { container } = render(
      <LinkPreviewCard preview={preview({ image: undefined, hasIcon: false, iconUrl: undefined, description: undefined })} />,
    );

    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.queryByText("記事の説明")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "記事のタイトル" })).toBeInTheDocument();
    expect(screen.getByText("Example")).toBeInTheDocument();
  });

  it("タイトルがなければ、サイト名を見出しにする", () => {
    render(<LinkPreviewCard preview={preview({ title: undefined })} />);

    expect(screen.getByRole("link", { name: "Example" })).toHaveAttribute("href", "https://example.com/post/1");
  });

  it("本人でなければ「x」を出さない", () => {
    render(<LinkPreviewCard preview={preview()} />);

    expect(screen.queryByRole("button", { name: "プレビューを削除" })).not.toBeInTheDocument();
  });

  it("本人は「x」ですぐ消せる（確認のダイアログは出さない）", async () => {
    const onRemove = vi.fn();
    render(<LinkPreviewCard preview={preview()} onRemove={onRemove} />);

    await userEvent.click(screen.getByRole("button", { name: "プレビューを削除" }));

    expect(onRemove).toHaveBeenCalledWith("01J8ZH5K000000000000000001");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ComposerLinkPreview", () => {
  it("取得中はホスト名を出す", () => {
    render(<ComposerLinkPreview preview={{ url: "https://example.com/post/1", state: "loading" }} />);

    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("取れたら、サイト名とタイトルを出す", () => {
    render(
      <ComposerLinkPreview
        preview={{ url: "https://example.com/post/1", state: "ok", siteName: "Example", title: "記事のタイトル" }}
      />,
    );

    expect(screen.getByText("Example")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "記事のタイトル" })).toHaveAttribute("href", "https://example.com/post/1");
  });

  it.each([
    ["取得中", { url: "https://example.com/post/1", state: "loading" } as const],
    ["取れた", { url: "https://example.com/post/1", state: "ok", siteName: "Example" } as const],
  ])("%s のカードも「x」で消せる（URL を渡す）", async (_name, view) => {
    const onRemove = vi.fn();
    render(<ComposerLinkPreview preview={view} onRemove={onRemove} />);

    await userEvent.click(screen.getByRole("button", { name: "プレビューを削除" }));

    expect(onRemove).toHaveBeenCalledWith("https://example.com/post/1");
  });
});

describe("isLargeImage（ADR 0065 の追記）", () => {
  it.each([
    [{ width: 1200, height: 630 }, true],
    [{ width: 1280, height: 720 }, true],
    [{ width: 400, height: 266 }, true],
    [{ width: 399, height: 200 }, false],
    [{ width: 1200, height: 1200 }, false],
    [{ width: 800, height: 1200 }, false],
    [{ width: 1200, height: 900 }, false],
  ])("%j → %s（幅 400px 以上で、幅 ÷ 高さが 1.5 以上）", (image, want) => {
    expect(isLargeImage(image)).toBe(want);
  });
});
