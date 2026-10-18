import { $createCodeNode } from "@lexical/code";
import { $createLinkNode } from "@lexical/link";
import { $createListItemNode, $createListNode, type ListItemNode } from "@lexical/list";
import { $createQuoteNode } from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type ElementNode,
  type LexicalNode,
  type TextFormatType,
} from "lexical";

import { type Block, type Inline, type ListBlock, parseBody } from "@/lib/chat/format/body-format";
import type { ChannelTable } from "@/lib/chat/format/channel-links";

import { $createMentionNode } from "./mention-node";

/**
 * 本文を入力欄に読み込む（ADR 0052 決定 2）。
 *
 * 解釈は表示と同じ `parseBody`（ADR 0051）。表示では太字なのに入力欄では記号が見える、というずれを作らないため。
 * names は ID から表示名を引く表。引けない ID はトークンのまま文字として入れる（表示と同じ扱い）。
 * channels はチャンネルへのリンク（`<#ID>`。ADR 0062）の名前を引く表。引けないものは同じくトークンの文字のまま入れ、
 * 保存すると元のトークンに戻る（決定 4）。
 */
export function $importBody(body: string, names: Readonly<Record<string, string>> = {}, channels: ChannelTable = {}): void {
  const root = $getRoot();
  root.clear();
  const lookup: Lookup = { names, channels };
  for (const block of parseBody(body)) root.append(...blockNodes(block, lookup));
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}

type Lookup = { names: Readonly<Record<string, string>>; channels: ChannelTable };

function blockNodes(block: Block, names: Lookup): ElementNode[] {
  switch (block.type) {
    case "paragraph":
      return [$createParagraphNode().append(...inlineNodes(block.children, [], names))];
    case "code":
      return [$createCodeNode().append(...textWithBreaks(block.text, []))];
    case "quote":
      // Lexical の引用はインラインしか持てないので、中のブロックは行に並べ直す。
      // 中のリストは記号ごと文字として入れる（`> - a` は書き出すと同じ本文に戻る）
      return [$createQuoteNode().append(...quoteLines(block.children, names))];
    case "list":
      return [listNode(block, names)];
  }
}

function quoteLines(blocks: Block[], names: Lookup): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  const pushLine = (line: LexicalNode[]) => {
    if (nodes.length > 0) nodes.push($createLineBreakNode());
    nodes.push(...line);
  };
  const pushList = (list: ListBlock, depth: number) => {
    list.items.forEach((item, i) => {
      const marker = list.ordered ? `${item.number ?? i + 1}. ` : "- ";
      pushLine([$createTextNode(`${"  ".repeat(depth)}${marker}`), ...inlineNodes(item.children, [], names)]);
      for (const sublist of item.sublists) pushList(sublist, depth + 1);
    });
  };
  for (const block of blocks) {
    if (block.type === "paragraph") pushLine(inlineNodes(block.children, [], names));
    else if (block.type === "list") pushList(block, 0);
    else if (block.type === "code") pushLine(textWithBreaks(block.text, []));
    else pushLine(quoteLines(block.children, names));
  }
  return nodes;
}

function listNode(list: ListBlock, names: Lookup) {
  const node = $createListNode(list.ordered ? "number" : "bullet", list.items[0]?.number ?? 1);
  for (const item of list.items) {
    node.append($createListItemNode().append(...inlineNodes(item.children, [], names)));
    // Lexical の入れ子のリストは、親の項目の次に「リストだけを持つ項目」として置く
    for (const sublist of item.sublists) {
      const holder: ListItemNode = $createListItemNode();
      node.append(holder.append(listNode(sublist, names)));
    }
  }
  return node;
}

const FORMAT_OF: Readonly<Record<"bold" | "italic" | "underline" | "strike", TextFormatType>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikethrough",
};

function inlineNodes(nodes: Inline[], formats: TextFormatType[], names: Lookup): LexicalNode[] {
  return nodes.flatMap((node): LexicalNode[] => {
    switch (node.type) {
      case "text":
        return textWithBreaks(node.text, formats);
      case "bold":
      case "italic":
      case "underline":
      case "strike":
        return inlineNodes(node.children, [...formats, FORMAT_OF[node.type]], names);
      case "code":
        return [formatted($createTextNode(node.text), [...formats, "code"])];
      case "link":
        return [$createLinkNode(node.url).append(formatted($createTextNode(node.label ?? node.url), formats))];
      case "mention": {
        if (node.kind !== "user") return [$createMentionNode(node.raw, `@${node.kind}`)];
        const name = names.names[node.id];
        return [name === undefined ? formatted($createTextNode(node.raw), formats) : $createMentionNode(node.raw, `@${name}`)];
      }
      case "channel": {
        // 入力欄のチップは文字だけで描くので、private も `#名前` にする（鍵のアイコンは本文の表示だけ）
        const channel = names.channels[node.id];
        return [channel === undefined ? formatted($createTextNode(node.raw), formats) : $createMentionNode(node.raw, `#${channel.name}`)];
      }
    }
  });
}

/** 改行を LineBreakNode にした文字の並び。 */
function textWithBreaks(text: string, formats: TextFormatType[]): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  text.split("\n").forEach((line, i) => {
    if (i > 0) nodes.push($createLineBreakNode());
    if (line !== "") nodes.push(formatted($createTextNode(line), formats));
  });
  return nodes;
}

function formatted<T extends ReturnType<typeof $createTextNode>>(node: T, formats: TextFormatType[]): T {
  for (const format of formats) if (!node.hasFormat(format)) node.toggleFormat(format);
  return node;
}
