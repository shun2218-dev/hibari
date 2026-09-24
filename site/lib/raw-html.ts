import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/**
 * Markdown のコードの外にある生の HTML を探す（ADR 0064 決定 2）。
 *
 * Fumadocs は .md の生の HTML を黙って捨てる（GitHub も `<script>` などは消す）。書いた文字が消えても気づけないので、
 * docs/ にはコードの外に HTML を書かない。`<` を文字として書くときはバッククォートで囲む。
 */
export function findRawHTML(markdown: string): { line: number; value: string }[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
  const found: { line: number; value: string }[] = [];
  visit(tree, "html", (node) => {
    found.push({ line: node.position?.start.line ?? 0, value: node.value });
  });
  return found;
}
