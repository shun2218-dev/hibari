/**
 * ページの題名を、本文の最初の `# ` 見出しから取る（ADR 0064 決定 2）。
 *
 * docs/ は GitHub で読む前提の Markdown で front matter を持たない。サイトの都合で front matter を足さないので（決定 1）、
 * Fumadocs のスキーマの既定値をここで作る。見出しの中のバッククォートは、タブやサイドバーに出すときに要らないので外す。
 * 見出しがなければファイル名にする。
 */
export function firstHeading(source: string, path: string): string {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(source);
  if (m) return m[1].replaceAll("`", "");
  return path.replace(/^.*\//, "").replace(/\.mdx?$/, "");
}
