import type { Folder, Item, Node, Root } from "fumadocs-core/page-tree";

/**
 * サイドバーの並び（ADR 0064 決定 4）。
 *
 * Fumadocs はディレクトリの構成からページの木を作るが、docs/ の構成は GitHub で読むためのもので、
 * サイトの節（はじめに・バックエンド・フロントエンド・設計判断）とは合わない。docs/ に meta.json を置かずに（決定 1）、
 * 自動で作った木から URL でページを拾い、節に並べ直す。
 * 節に置いていないページも消さずに「その他」の後ろに足す（docs/ にファイルを足したらサイトにも出る）。
 */

export const STORYBOOK_URL = "https://ui.hibari-chat.com";

/** OpenAPI から作るページの置き場所（lib/source.ts の baseDir）。 */
export const REST_API_DIR = "rest-api";

type Section = { name: string; entries: Entry[] };

type Entry =
  | { kind: "page"; url: string; name?: string }
  | { kind: "folder"; url: string; name: string }
  | { kind: "link"; url: string; name: string };

const sections: Section[] = [
  { name: "", entries: [{ kind: "page", url: "/", name: "はじめに" }] },
  {
    name: "バックエンド",
    entries: [
      { kind: "page", url: "/guide/backend" },
      { kind: "page", url: "/guide/data-model" },
      { kind: "folder", url: `/${REST_API_DIR}`, name: "REST API" },
      { kind: "page", url: "/events" },
    ],
  },
  {
    name: "フロントエンド",
    entries: [
      { kind: "page", url: "/guide/frontend" },
      { kind: "page", url: "/ui/tokens" },
      { kind: "page", url: "/ui", name: "画面仕様" },
      { kind: "link", url: STORYBOOK_URL, name: "コンポーネント（Storybook）" },
    ],
  },
  { name: "設計判断", entries: [{ kind: "folder", url: "/adr", name: "設計判断（ADR）" }] },
  {
    name: "その他",
    entries: [
      { kind: "page", url: "/roadmap" },
      { kind: "page", url: "/deploy" },
    ],
  },
];

export function arrangeTree(tree: Root): Root {
  const pages = new Map<string, Item>();
  collectPages(tree.children, pages);

  const placed = new Set<Node>();
  const children: Node[] = [];
  for (const section of sections) {
    const nodes: Node[] = [];
    for (const entry of section.entries) {
      const found = find(entry, tree.children, pages);
      if (!found) continue;
      nodes.push(found.node);
      placed.add(found.original);
    }
    if (nodes.length === 0) continue;
    if (section.name !== "") children.push({ type: "separator", name: section.name });
    children.push(...nodes);
  }

  // 節に置いていないページとフォルダ（docs/ に足したファイル）を、自動で作った木の順で最後に足す
  // 中にページのないフォルダ（docs/api/ は openapi.json だけで Markdown がない）は出さない
  const rest = tree.children.filter(
    (node) => !isPlaced(node, placed) && !(node.type === "folder" && !node.index && descendantUrls(node).length === 0),
  );
  if (rest.length > 0) {
    if (!children.some((n) => n.type === "separator" && n.name === "その他")) {
      children.push({ type: "separator", name: "その他" });
    }
    children.push(...rest);
  }
  return { ...tree, children };
}

function collectPages(nodes: Node[], pages: Map<string, Item>): void {
  for (const node of nodes) {
    if (node.type === "page") pages.set(node.url, node);
    if (node.type === "folder") {
      if (node.index) pages.set(node.index.url, node.index);
      collectPages(node.children, pages);
    }
  }
}

/**
 * URL が指すフォルダ。index がその URL か、中のページがすべてその URL の下にあるフォルダのうち、いちばん外のもの
 * （OpenAPI のフォルダは index を持たない）。
 */
function findFolder(nodes: Node[], url: string): Folder | undefined {
  const folders = nodes.filter((n): n is Folder => n.type === "folder");
  const match = folders.find((f) => {
    if (f.index) return f.index.url === url;
    const urls = descendantUrls(f);
    return urls.length > 0 && urls.every((u) => u === url || u.startsWith(`${url}/`));
  });
  if (match) return match;
  for (const f of folders) {
    const inner = findFolder(f.children, url);
    if (inner) return inner;
  }
  return undefined;
}

/**
 * フォルダと同じ URL のページ（README.md をフォルダの URL にしたもの）を、フォルダの index にする。
 * 中の 1 ページのままだと、フォルダの名前と README の題名が 2 段に並ぶ。
 */
function withIndex(folder: Folder, url: string): Folder {
  if (folder.index) return folder;
  const index = folder.children.find((n): n is Item => n.type === "page" && n.url === url);
  if (!index) return folder;
  return { ...folder, index, children: folder.children.filter((n) => n !== index) };
}

function descendantUrls(folder: Folder): string[] {
  return folder.children.flatMap((n) => (n.type === "page" ? [n.url] : n.type === "folder" ? descendantUrls(n) : []));
}

/** 節に置く node と、自動で作った木の元の node（置いたかどうかの判定に使う）。 */
function find(entry: Entry, nodes: Node[], pages: Map<string, Item>): { node: Node; original: Node } | undefined {
  switch (entry.kind) {
    case "page": {
      const page = pages.get(entry.url);
      if (!page) return undefined;
      return { node: entry.name ? { ...page, name: entry.name } : page, original: page };
    }
    case "folder": {
      const folder = findFolder(nodes, entry.url);
      return folder ? { node: withIndex({ ...folder, name: entry.name }, entry.url), original: folder } : undefined;
    }
    case "link": {
      const link: Item = { type: "page", name: entry.name, url: entry.url, external: true };
      return { node: link, original: link };
    }
  }
}

function isPlaced(node: Node, placed: Set<Node>): boolean {
  if (placed.has(node)) return true;
  // フォルダの index だけを節に置いたとき（`/ui` の README）は、フォルダの残りのページが節に置いてあるかで決める
  if (node.type === "folder") {
    const inner = [...(node.index ? [node.index] : []), ...node.children];
    return inner.length > 0 && inner.every((n) => isPlaced(n, placed));
  }
  return false;
}
