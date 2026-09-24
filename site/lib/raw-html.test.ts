import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { findRawHTML } from "./raw-html";

const DOCS_DIR = join(import.meta.dirname, "..", "..", "docs");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

describe("findRawHTML", () => {
  it.each([
    { name: "地の文のタグ", markdown: "「<script> や HTML を書いても…」\n", want: 1 },
    { name: "HTML のコメント", markdown: "<!-- メモ -->\n", want: 1 },
    { name: "インラインのコード", markdown: "「`<script>` や HTML を書いても…」\n", want: 0 },
    { name: "コードブロック", markdown: "```html\n<div></div>\n```\n", want: 0 },
    { name: "山かっこのない不等号", markdown: "seq < last_user_seq のとき\n", want: 0 },
  ])("$name", ({ markdown, want }) => {
    expect(findRawHTML(markdown)).toHaveLength(want);
  });
});

describe("docs/", () => {
  it("コードの外に生の HTML を書かない（サイトで黙って消えるため）", () => {
    const problems = markdownFiles(DOCS_DIR).flatMap((path) =>
      findRawHTML(readFileSync(path, "utf8")).map(({ line, value }) => `docs/${relative(DOCS_DIR, path)}:${line}: ${value}`),
    );
    expect(problems).toEqual([]);
  });
});
