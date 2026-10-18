"use client";

import { $isCodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMPOSITION_END_TAG,
  HISTORIC_TAG,
  PASTE_TAG,
  type TextFormatType,
  TextNode,
} from "lexical";
import { useEffect } from "react";

import { type Inline, parseInline } from "@/lib/chat/format/body-format";

import { SYNC_TAG } from "./sync";

const INLINE_MARKERS = ["__", "*", "_", "~", "`"] as const;

const FORMAT_OF: Readonly<Record<string, TextFormatType>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikethrough",
  code: "code",
};

/** 本文の頭からキャレットまでの文字の末尾が、ちょうど閉じた書式になっていれば、その開始位置と種類を返す。 */
export function findTypedFormat(text: string): { start: number; marker: string; kind: keyof typeof FORMAT_OF } | null {
  for (const marker of INLINE_MARKERS) {
    if (!text.endsWith(marker)) continue;
    for (let start = text.length - marker.length * 2 - 1; start >= 0; start--) {
      if (!text.startsWith(marker, start)) continue;
      // `__下線__` を打っている途中の `_下線_` を斜体にしない（`__` の片方の `_` は斜体の記号ではない）
      if (marker === "_" && (text[start - 1] === "_" || text[start + 1] === "_" || text[text.length - 2] === "_")) continue;
      // 開く記号の前は表示の解釈と同じく英数字であってはいけない
      if (/[A-Za-z0-9]/u.test(text[start - 1] ?? "")) continue;
      const nodes = parseInline(text.slice(start));
      if (nodes.length === 1 && isKind(nodes[0])) return { start, marker, kind: nodes[0].type };
    }
  }
  return null;
}

function isKind(node: Inline): node is Inline & { type: keyof typeof FORMAT_OF } {
  return node.type in FORMAT_OF;
}

/** node を [0, a) [a, b) [b, 末尾) に分け、真ん中を返す。 */
function splitAt(node: TextNode, a: number, b: number): (TextNode | undefined)[] {
  const offsets = [a, b].filter((o) => o > 0 && o < node.getTextContentSize());
  const parts = offsets.length > 0 ? node.splitText(...offsets) : [node];
  const middleIndex = a > 0 ? 1 : 0;
  return [a > 0 ? parts[0] : undefined, parts[middleIndex]];
}

/**
 * 記号を打つとその場で書式にする（ADR 0052 決定 5）。`*太字*` の閉じる `*` を打った時点で太字にする。
 *
 * 書式になるかの判定は表示と同じ `parseInline`（ADR 0051）で行う。Lexical の Markdown のショートカットは、
 * 境界を「ASCII の記号か空白」で見るので、`これは*太字*です` が書式にならない。
 * 行頭の `> ` `- ` `1. ` ` ``` ` は Lexical のショートカット（rich-text-input.tsx）に任せる。
 *
 * いつ判定するかは Lexical の Markdown のショートカットと同じにする。更新のあとで、キャレットが 1 文字ぶんだけ進んだとき
 * （1 文字打ったとき）と、IME の確定で記号が入ったとき。ブラウザの入力は beforeinput / input を経るので、
 * ノードの変換の時点ではキャレットがまだ打った文字の手前にあることがある（実物のブラウザで確かめた）。
 * 貼り付けは 1 文字より多く進むので判定しない（貼ったテキストの記号は解釈しない。ADR 0052 決定 5）。
 */
export function InlineMarkdownPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerUpdateListener(({ tags, dirtyLeaves, editorState, prevEditorState }) => {
        if (tags.has(HISTORIC_TAG) || tags.has(SYNC_TAG) || tags.has(PASTE_TAG) || editor.isComposing()) return;
        const compositionEnd = tags.has(COMPOSITION_END_TAG);
        const selection = editorState.read($getSelection);
        const prevSelection = prevEditorState.read($getSelection);
        if (!$isRangeSelection(selection) || !$isRangeSelection(prevSelection) || !selection.isCollapsed()) return;
        if (selection.is(prevSelection) && !compositionEnd) return;
        const key = selection.anchor.key;
        const caret = selection.anchor.offset;
        if (!dirtyLeaves.has(key)) return;
        const text = editorState.read(() => {
          const node = $getNodeByKey(key);
          return $isTextNode(node) && node.getFormat() === 0 && node.getMode() === "normal" && !$isCodeNode(node.getTopLevelElement())
            ? node.getTextContent()
            : null;
        });
        if (text === null || !"*_~`".includes(text[caret - 1] ?? "")) return;
        // 1 文字打ったときだけ（IME の確定は何文字でも入るので除く）
        if (!compositionEnd && prevSelection.anchor.key === key && caret !== prevSelection.anchor.offset + 1) return;
        const match = findTypedFormat(text.slice(0, caret));
        if (!match) return;
        editor.update(() => {
          const node = $getNodeByKey(key);
          if (!$isTextNode(node) || node.getTextContent() !== text) return;
          const inner = text.slice(match.start + match.marker.length, caret - match.marker.length);
          node.setTextContent(text.slice(0, match.start) + inner + text.slice(caret));
          const [, middle] = splitAt(node, match.start, match.start + inner.length);
          if (!middle) return;
          middle.toggleFormat(FORMAT_OF[match.kind]);
          // 続けて打つ文字は書式なしにする（閉じる記号を打ったのだから、書式はそこで終わり）
          const size = middle.getTextContentSize();
          middle.select(size, size).format = 0;
        });
      }),
    [editor],
  );
  return null;
}
