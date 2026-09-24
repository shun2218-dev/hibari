/**
 * docs/ の Markdown のリンクを、サイトで辿れる形にする（ADR 0064 決定 2）。
 *
 * docs/ は GitHub で読む前提なので、リンクはファイルからの相対パスで書いてある。
 * - `(0011-….md)` のような同じディレクトリの .md: Fumadocs の相対リンクは `./` か `../` で始まるものしか解決しないので `./` を補う
 * - docs/ の外のファイル（`../web/app/globals.css` など）: サイトには載らないので、GitHub の該当ファイルに向ける
 * - URL・ページ内のアンカー・サイトの絶対パス: そのまま
 */

export const REPOSITORY_URL = "https://github.com/shun2218-dev/hibari";

/** GitHub で開くときの枝。サイトは main（リリース）から作る。 */
const BRANCH = "main";

/**
 * @param href Markdown に書いてあるリンク先
 * @param filePath リンクを書いたファイルの、docs/ からのパス（`adr/README.md`）
 */
export function resolveDocLink(href: string, filePath: string): string {
  if (href === "" || href.startsWith("#") || href.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;

  const [path, hash = ""] = splitHash(href);
  if (path.endsWith(".md")) {
    const repoPath = resolvePath(`docs/${dirname(filePath)}`, path);
    // docs/ の中の .md はサイトのページ。Fumadocs の相対リンクに渡す
    if (repoPath.startsWith("docs/")) return path.startsWith(".") ? href : `./${href}`;
    return `${REPOSITORY_URL}/blob/${BRANCH}/${repoPath}${hash}`;
  }
  const repoPath = resolvePath(`docs/${dirname(filePath)}`, path);
  return `${REPOSITORY_URL}/blob/${BRANCH}/${repoPath}${hash}`;
}

function splitHash(href: string): [string, string?] {
  const i = href.indexOf("#");
  return i === -1 ? [href] : [href.slice(0, i), href.slice(i)];
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** base（リポジトリのルートからのディレクトリ）から見た相対パスを、リポジトリのルートからのパスにする。 */
function resolvePath(base: string, relative: string): string {
  const parts = base.split("/").filter((p) => p !== "");
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}
