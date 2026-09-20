import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CatalogBrowser } from "./catalog-browser";
import { filterPreviewCatalog, type PreviewEntry } from "./catalog";

const entries: PreviewEntry[] = [
  { name: "auth/login", title: "ログイン", since: "1.5" },
  { name: "auth/login-dark", title: "ログイン（ダーク）", dark: true, since: "1.5" },
  { name: "chat/reactions", title: "絵文字のリアクション", since: "6.7" },
  { name: "chat/mobile-reactions", title: "絵文字のリアクション（モバイル）", mobile: true, since: "6.7" },
  { name: "chat/threads", title: "参加しているスレッドの一覧", since: "6.5" },
];

// グループの見出しと、左のサイドバーのボタンは同じ名前になるので、見出しの中から取る。
const groupButton = (name: string) =>
  within(screen.getByRole("heading", { name: new RegExp(`^${name}`) })).getByRole("button");

describe("filterPreviewCatalog", () => {
  it("matches the name and the title, ignoring case", () => {
    expect(filterPreviewCatalog(entries, "REACTIONS").map((e) => e.name)).toEqual([
      "chat/reactions",
      "chat/mobile-reactions",
    ]);
    expect(filterPreviewCatalog(entries, "スレッド").map((e) => e.name)).toEqual(["chat/threads"]);
  });

  it("takes words separated by spaces as AND", () => {
    expect(filterPreviewCatalog(entries, "reactions mobile").map((e) => e.name)).toEqual(["chat/mobile-reactions"]);
  });

  it("narrows by the phase", () => {
    expect(filterPreviewCatalog(entries, "", "6.7").map((e) => e.name)).toEqual([
      "chat/reactions",
      "chat/mobile-reactions",
    ]);
    expect(filterPreviewCatalog(entries, "リアクション", "6.5")).toEqual([]);
  });
});

describe("<CatalogBrowser />", () => {
  it("collapses every group at first and shows the counts", () => {
    render(<CatalogBrowser entries={entries} />);

    expect(groupButton("認証")).toHaveAttribute("aria-expanded", "false");
    expect(groupButton("チャット")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // 見出しとサイドバーの両方に件数を出す（認証 2 件 / チャット 3 件）
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("opens one group when its heading is pressed, and leaves the others closed", async () => {
    const user = userEvent.setup();
    render(<CatalogBrowser entries={entries} />);

    await user.click(groupButton("チャット"));

    expect(groupButton("チャット")).toHaveAttribute("aria-expanded", "true");
    // 行の名前は、表示名・目印・ファイル名をつないだもの
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/dev/preview/chat/reactions",
      "/dev/preview/chat/mobile-reactions",
      "/dev/preview/chat/threads",
    ]);
    expect(screen.getByRole("link", { name: "絵文字のリアクション6.7chat/reactions" })).toBeInTheDocument();
  });

  it("shows only the matching screens while searching, even in collapsed groups", async () => {
    const user = userEvent.setup();
    render(<CatalogBrowser entries={entries} />);

    await user.type(screen.getByRole("searchbox", { name: "画面を検索" }), "reactions");

    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/dev/preview/chat/reactions",
      "/dev/preview/chat/mobile-reactions",
    ]);
    // 一致しないグループは、見出しごと消す
    expect(screen.queryByRole("heading", { name: /^認証/ })).not.toBeInTheDocument();
  });

  it("narrows by the phase chips", async () => {
    const user = userEvent.setup();
    render(<CatalogBrowser entries={entries} />);

    await user.click(screen.getByRole("button", { name: "6.5 スレッド" }));

    expect(screen.getByRole("button", { name: "6.5 スレッド" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/dev/preview/chat/threads",
    ]);
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<CatalogBrowser entries={entries} />);

    await user.type(screen.getByRole("searchbox", { name: "画面を検索" }), "存在しない画面");

    expect(screen.getByText("一致する画面がありません。")).toBeInTheDocument();
  });

  it("moves to the search box with / and clears the conditions with Escape", async () => {
    const user = userEvent.setup();
    render(<CatalogBrowser entries={entries} />);
    const search = screen.getByRole("searchbox", { name: "画面を検索" });

    await user.keyboard("/");
    expect(search).toHaveFocus();

    await user.keyboard("reactions");
    expect(search).toHaveValue("reactions");

    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
