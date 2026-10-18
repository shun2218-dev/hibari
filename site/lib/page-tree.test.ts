import type { Folder, Item, Node, Root } from "fumadocs-core/page-tree";
import { describe, expect, it } from "vitest";

import { arrangeTree, STORYBOOK_URL } from "./page-tree";

const page = (url: string, name = url): Item => ({ type: "page", url, name });
const folder = (name: string, index: Item | undefined, children: Node[]): Folder => ({
  type: "folder",
  name,
  index,
  children,
});

/** Fumadocs が docs/ の構成から作る木（ディレクトリ名の順）。 */
function autoTree(extra: Node[] = []): Root {
  return {
    name: "docs",
    children: [
      // README.md をフォルダの URL にしたページは、Fumadocs ではフォルダの index ではなく中の 1 ページになる
      folder("Adr", undefined, [page("/adr", "設計判断（ADR）の一覧"), page("/adr/0001-auth"), page("/adr/0002-seq")]),
      // openapi.json だけで Markdown のないディレクトリ
      folder("Api", undefined, []),
      page("/deploy", "環境ごとの設定"),
      page("/events", "WebSocket イベント"),
      folder("Guide", page("/", "hibari"), []),
      folder("Rest api", undefined, [folder("Messages", undefined, [page("/rest-api/messages/send-message")])]),
      page("/roadmap", "hibari ロードマップ"),
      folder("Ui", undefined, [page("/ui", "画面仕様（Phase 1.5）"), page("/ui/tokens", "デザイントークン")]),
      ...extra,
    ],
  };
}

function outline(nodes: Node[]): string[] {
  return nodes.map((n) => {
    if (n.type === "separator") return `--- ${n.name}`;
    if (n.type === "folder") return `[${n.name}]`;
    return `${n.name} ${n.url}`;
  });
}

describe("arrangeTree", () => {
  it("節に並べ直し、フォルダの名前を付け直す", () => {
    expect(outline(arrangeTree(autoTree()).children)).toEqual([
      "はじめに /",
      "--- バックエンド",
      "[REST API]",
      "WebSocket イベント /events",
      "--- フロントエンド",
      "デザイントークン /ui/tokens",
      "画面仕様 /ui",
      `コンポーネント（Storybook） ${STORYBOOK_URL}`,
      "--- 設計判断",
      "[設計判断（ADR）]",
      "--- その他",
      "hibari ロードマップ /roadmap",
      "環境ごとの設定 /deploy",
    ]);
  });

  it("Storybook は外部のリンクにする", () => {
    const storybook = arrangeTree(autoTree()).children.find((n) => n.type === "page" && n.url === STORYBOOK_URL);
    expect(storybook).toMatchObject({ external: true });
  });

  it("ADR のフォルダは中身を残す", () => {
    const adr = arrangeTree(autoTree()).children.find((n): n is Folder => n.type === "folder" && n.name === "設計判断（ADR）");
    expect(adr?.index?.url).toBe("/adr");
    expect(outline(adr?.children ?? [])).toEqual(["/adr/0001-auth /adr/0001-auth", "/adr/0002-seq /adr/0002-seq"]);
  });

  it("まだないページ（docs/guide の各ページ）は飛ばす", () => {
    const urls = outline(arrangeTree(autoTree()).children);
    expect(urls.some((u) => u.includes("/guide/"))).toBe(false);
  });

  it("節に置いていないページも消さずに最後に足す", () => {
    const tree = arrangeTree(autoTree([page("/glossary", "用語集")]));
    expect(outline(tree.children).at(-1)).toBe("用語集 /glossary");
  });
});
