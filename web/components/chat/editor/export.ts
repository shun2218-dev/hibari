import { $isCodeNode } from "@lexical/code";
import { $isLinkNode } from "@lexical/link";
import { $isListItemNode, $isListNode, type ListNode } from "@lexical/list";
import { $isQuoteNode } from "@lexical/rich-text";
import { $getRoot, $isElementNode, $isLineBreakNode, $isParagraphNode, $isTextNode, type LexicalNode } from "lexical";

import { type Inline, parseInline } from "@/lib/chat/body-format";

import { $isMentionNode, $mentionToken } from "./mention-node";

/**
 * 入力欄の中身を本文のテキストに書き出す（ADR 0052 決定 2）。
 *
 * 書き出したテキストは、表示の解釈（`parseBody`。ADR 0051）で読むと入力欄と同じ見た目になるようにする。
 * ADR 0051 の記法にはエスケープがないので、書けない書式（英単語の途中だけの太字など）は書式ごと落とす。
 * 記号を残すと、送ったあとに `*` がそのまま見えてしまう。
 */
export function $exportBody(): string {
  return $getRoot()
    .getChildren()
    .map((block) => exportBlock(block))
    .join("\n");
}

function exportBlock(node: LexicalNode): string {
  if ($isCodeNode(node)) return `\`\`\`\n${node.getTextContent()}\n\`\`\``;
  if ($isQuoteNode(node))
    return exportInline(node.getChildren())
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  if ($isListNode(node)) return exportList(node, 0).join("\n");
  if ($isParagraphNode(node) || $isElementNode(node)) return exportInline(node.getChildren());
  return node.getTextContent();
}

function exportList(list: ListNode, depth: number): string[] {
  const lines: string[] = [];
  const ordered = list.getListType() === "number";
  for (const item of list.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const children = item.getChildren();
    // 入れ子のリストは「リストだけを持つ項目」として並んでいる（import.ts）
    if (children.length === 1 && $isListNode(children[0])) {
      lines.push(...exportList(children[0], depth + 1));
      continue;
    }
    const marker = ordered ? `${item.getValue()}. ` : "- ";
    lines.push(`${"  ".repeat(depth)}${marker}${exportInline(children)}`);
  }
  return lines;
}

// ---- インライン ----

type Format = "bold" | "italic" | "underline" | "strike";

/** 外側から内側への並び。斜体（`_`）と下線（`__`）を隣り合わせにしにくい順にしてある。 */
const ORDER: readonly Format[] = ["underline", "bold", "strike", "italic"];
const MARK: Readonly<Record<Format, string>> = { underline: "__", bold: "*", strike: "~", italic: "_" };
const LEXICAL_FORMAT: Readonly<Record<Format, "bold" | "italic" | "underline" | "strikethrough">> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikethrough",
};

/** 1 行の中の部品。s は本文に書く文字列（リンクやコードは記法を含む）、formats はその外側に付ける書式。 */
type Item = { s: string; formats: ReadonlySet<Format> };

type Segment =
  | { kind: "text"; text: string; formats: Set<Format>; code: boolean; link?: string }
  | { kind: "atom"; text: string; formats: Set<Format> }
  | { kind: "break" };

function exportInline(nodes: LexicalNode[]): string {
  const lines: Segment[][] = [[]];
  for (const segment of collect(nodes)) {
    if (segment.kind === "break") lines.push([]);
    else lines[lines.length - 1].push(segment);
  }
  return lines.map((line) => exportLine(toItems(line))).join("\n");
}

function collect(nodes: LexicalNode[], link?: string): Segment[] {
  return nodes.flatMap((node): Segment[] => {
    if ($isLineBreakNode(node)) return [{ kind: "break" }];
    if ($isMentionNode(node)) return [{ kind: "atom", text: $mentionToken(node), formats: formatsOf(node) }];
    if ($isTextNode(node))
      return [{ kind: "text", text: node.getTextContent(), formats: formatsOf(node), code: node.hasFormat("code"), link }];
    if ($isLinkNode(node)) return collect(node.getChildren(), node.getURL());
    if ($isElementNode(node)) return collect(node.getChildren(), link);
    return [];
  });
}

function formatsOf(node: { hasFormat: (f: "bold" | "italic" | "underline" | "strikethrough") => boolean }) {
  return new Set(ORDER.filter((f) => node.hasFormat(LEXICAL_FORMAT[f])));
}

/** 部品に分ける。リンクは続く文字をまとめて 1 つに、コードは記号で囲む。 */
function toItems(segments: Segment[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === "break") continue;
    if (seg.kind === "atom") {
      items.push({ s: seg.text, formats: seg.formats });
      continue;
    }
    if (seg.link !== undefined) {
      const url = seg.link;
      const group = [seg];
      while (i + 1 < segments.length) {
        const next = segments[i + 1];
        if (next.kind !== "text" || next.link !== url) break;
        group.push(next);
        i++;
      }
      const label = group.map((g) => g.text).join("");
      // 文字の中の書式は記法で書けないので、全部の文字に共通する書式だけを外側に付ける
      const formats = new Set(ORDER.filter((f) => group.every((g) => g.formats.has(f))));
      items.push({ s: linkText(url, label), formats });
      continue;
    }
    items.push({ s: seg.code ? codeText(seg.text) : seg.text, formats: seg.formats });
  }
  return items;
}

/** 文字と URL が同じなら URL だけ、違えば `<URL|文字>`。文字に書けない文字があれば URL だけにする（ADR 0051 決定 4 の追記）。 */
function linkText(url: string, label: string): string {
  if (label === url || !/^https?:\/\//u.test(url)) return label === url ? url : label;
  if (label === "" || /[<>`\n]/u.test(label) || /[\s<>`|]/u.test(url)) return url;
  return `<${url}|${label}>`;
}

/** インラインコード。中にバッククォートがあると閉じられないので、コードにせず文字のまま書く。 */
function codeText(text: string): string {
  return text === "" || text.includes("`") ? text : `\`${text}\``;
}

/**
 * 1 行を書き出す。書式の記号を付けたあと、表示の解釈で読み直して意図と同じになるかを確かめる。
 * 同じにならなければ、書式を 1 つずつ外して試し、最後は書式なしにする（ADR 0052 決定 2）。
 */
function exportLine(items: Item[]): string {
  const want = (allowed: ReadonlySet<Format>) => intended(items, allowed);
  const attempts: ReadonlySet<Format>[] = [new Set(ORDER), ...ORDER.map((f) => new Set(ORDER.filter((g) => g !== f))), new Set()];
  for (const allowed of attempts) {
    const text = render(items, allowed);
    if (sameInline(parseInline(text), want(allowed))) return text;
  }
  return render(items, new Set());
}

type Token = { t: "open"; f: Format } | { t: "close"; f: Format } | { t: "text"; s: string };

function tokens(items: Item[], allowed: ReadonlySet<Format>): Token[] {
  const out: Token[] = [];
  const stack: Format[] = [];
  for (const item of items) {
    const wanted = new Set([...item.formats].filter((f) => allowed.has(f)));
    const keep = stack.findIndex((f) => !wanted.has(f));
    if (keep >= 0) {
      while (stack.length > keep) out.push({ t: "close", f: stack.pop() as Format });
    }
    for (const f of ORDER) {
      if (wanted.has(f) && !stack.includes(f)) {
        out.push({ t: "open", f });
        stack.push(f);
      }
    }
    out.push({ t: "text", s: item.s });
  }
  while (stack.length > 0) out.push({ t: "close", f: stack.pop() as Format });
  return moveSpacesOutside(out);
}

/** 書式の端の空白を記号の外へ出す（`*abc *` は太字にならないので `*abc* ` にする）。 */
function moveSpacesOutside(tokens: Token[]): Token[] {
  const out = [...tokens];
  for (let i = 0; i < out.length; i++) {
    const tok = out[i];
    if (tok.t !== "text") continue;
    const lead = /^\s+/u.exec(tok.s)?.[0] ?? "";
    let j = i - 1;
    while (lead !== "" && j >= 0 && out[j].t === "open") j--;
    if (lead !== "" && j < i - 1) {
      out[i] = { t: "text", s: tok.s.slice(lead.length) };
      out.splice(j + 1, 0, { t: "text", s: lead });
      i++;
    }
    const cur = out[i] as { t: "text"; s: string };
    const trail = /\s+$/u.exec(cur.s)?.[0] ?? "";
    let k = i + 1;
    while (trail !== "" && k < out.length && out[k].t === "close") k++;
    if (trail !== "" && k > i + 1) {
      out[i] = { t: "text", s: cur.s.slice(0, cur.s.length - trail.length) };
      out.splice(k, 0, { t: "text", s: trail });
    }
  }
  // 中身のない書式（`**`）を取り除く
  return out.filter((tok, idx) => {
    if (tok.t === "open") return !(out[idx + 1]?.t === "close");
    if (tok.t === "close") return !(out[idx - 1]?.t === "open");
    return true;
  });
}

function render(items: Item[], allowed: ReadonlySet<Format>): string {
  return tokens(items, allowed)
    .map((tok) => (tok.t === "text" ? tok.s : MARK[tok.f]))
    .join("");
}

/** 記号を付けた結果として期待する木。部品ごとの解釈を、書式の入れ子で包んだもの。 */
function intended(items: Item[], allowed: ReadonlySet<Format>): Inline[] {
  const root: Inline[] = [];
  const stack: { f: Format; children: Inline[] }[] = [];
  const target = () => (stack.length > 0 ? stack[stack.length - 1].children : root);
  for (const tok of tokens(items, allowed)) {
    if (tok.t === "open") {
      const node = { f: tok.f, children: [] as Inline[] };
      stack.push(node);
    } else if (tok.t === "close") {
      const node = stack.pop() as { f: Format; children: Inline[] };
      target().push({ type: node.f, children: node.children });
    } else {
      target().push(...parseInline(tok.s));
    }
  }
  return root;
}

/** 隣り合う文字をまとめてから比べる（記号の置き方で文字の分かれ方が変わるだけの差を無視する）。 */
function sameInline(a: Inline[], b: Inline[]): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const n: Inline = "children" in node ? { ...node, children: normalize(node.children) } : node;
    const last = out[out.length - 1];
    if (n.type === "text" && last?.type === "text") out[out.length - 1] = { type: "text", text: last.text + n.text };
    else if (!(n.type === "text" && n.text === "")) out.push(n);
  }
  return out;
}
