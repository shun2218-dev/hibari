import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useDocumentTitle } from "./use-document-title";

describe("useDocumentTitle", () => {
  afterEach(() => {
    document.title = "";
  });

  it("タイトルを入れ、離れたら元に戻す", () => {
    document.title = "hibari";
    const { unmount } = renderHook(() => useDocumentTitle("general - 開発チーム - hibari"));
    expect(document.title).toBe("general - 開発チーム - hibari");

    unmount();
    expect(document.title).toBe("hibari");
  });

  it("undefined の間は metadata のタイトルのまま", () => {
    document.title = "hibari";
    renderHook(() => useDocumentTitle(undefined));
    expect(document.title).toBe("hibari");
  });

  it("タイトルが変わったら入れ直す（アクティビティの数が増えた）", () => {
    document.title = "hibari";
    const { rerender, unmount } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: "general - 開発チーム - hibari" },
    });

    rerender({ title: "general - 開発チーム - 1 個の新しいアイテム - hibari" });
    expect(document.title).toBe("general - 開発チーム - 1 個の新しいアイテム - hibari");

    unmount();
    expect(document.title).toBe("hibari");
  });

  it("Next.js が metadata の <title> を入れ直しても、入れ直し返す", async () => {
    document.title = "hibari";
    const { unmount } = renderHook(() => useDocumentTitle("general - 開発チーム - hibari"));

    // ページを移ったときに head の <title> が差し替わる
    document.head.querySelector("title")?.remove();
    const fresh = document.createElement("title");
    fresh.textContent = "hibari";
    document.head.append(fresh);
    await waitFor(() => expect(document.title).toBe("general - 開発チーム - hibari"));

    // 同じ <title> の文字だけ書き換わる
    fresh.textContent = "hibari";
    await waitFor(() => expect(document.title).toBe("general - 開発チーム - hibari"));

    unmount();
    expect(document.title).toBe("hibari");
  });
});
