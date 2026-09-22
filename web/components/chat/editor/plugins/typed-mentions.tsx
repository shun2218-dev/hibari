"use client";

import { $isCodeNode } from "@lexical/code";
import { $isLinkNode } from "@lexical/link";
import { $getRoot, $getSelection, $isRangeSelection, $isTextNode, TextNode } from "lexical";

import { $createMentionNode } from "@/components/chat/editor/mention-node";
import type { MentionCandidate } from "@/lib/chat/format/mentions";

/**
 * 入力中に打った @ の文字列を、メンションのノードに変える（ADR 0043）。
 */
// ---- 手で打った `@ハンドル` をメンションにする（ADR 0043 の「補完から選んでも、手で打っても同じ本文」） ----

/** 打ち終えた `@ハンドル`。後ろが空白か句読点（atEnd なら文字の終わりも）のものだけを見る（打っている途中で変えない）。 */
const TYPED_MENTION = /(^|\s)@([A-Za-z0-9_]{1,32})(?=[\s、。,.!?！？)）」』]|$)/gu;

/**
 * 手で打った `@ハンドル` を、候補に一致すればメンションのノードにする。コードとリンクの中は変えない（ADR 0051 決定 5）。
 * `@channel` / `@here` は、同じハンドルの人がいても全員宛てにする（ADR 0043。Slack と同じ）。
 *
 * - 打っている途中（ノードの変換）: キャレットのあるノードだけ、後ろに空白か句読点を打った `@ハンドル` を変える
 * - 送信の Enter: 本文の全体で、末尾に残った `@ハンドル` も変える
 */
export function $convertTypedMentions(candidates: readonly MentionCandidate[], only?: TextNode): void {
  const byHandle = new Map(candidates.flatMap((c) => (c.kind === "user" ? [[c.handle.toLowerCase(), c] as const] : [])));
  const nodes = only ? [only] : $getRoot().getAllTextNodes();
  for (const node of nodes) {
    if (!node.isAttached() || node.getMode() !== "normal" || node.hasFormat("code")) continue;
    if ($isCodeNode(node.getTopLevelElement()) || $isLinkNode(node.getParent())) continue;
    const text = node.getTextContent();
    const selection = $getSelection();
    const caret = $isRangeSelection(selection) && selection.anchor.key === node.getKey() ? selection.anchor.offset : null;
    for (const m of text.matchAll(TYPED_MENTION)) {
      const at = m.index + m[1].length;
      const end = at + 1 + m[2].length;
      // 打っている途中は、文字の終わりの `@ハンドル` を変えない（補完で選ぶかもしれない）
      if (only && end === text.length) continue;
      const handle = m[2].toLowerCase();
      const user = byHandle.get(handle);
      const mention =
        handle === "channel" || handle === "here"
          ? $createMentionNode(`<!${handle}>`, `@${handle}`)
          : user?.kind === "user"
            ? $createMentionNode(`<@${user.id}>`, `@${user.name}`)
            : null;
      if (!mention) continue;
      const parts = node.splitText(...[at, end].filter((o) => o > 0 && o < text.length));
      const target = parts[at > 0 ? 1 : 0];
      target.replace(mention);
      // キャレットがこのノードの後ろにあれば、チップの後ろの同じ位置に置き直す
      const after = mention.getNextSibling();
      if (caret !== null && caret >= end && $isTextNode(after)) after.select(caret - end, caret - end);
      // 残りのノードは、次の変換（ノードが変わると呼ばれる）か次の呼び出しで見る
      if (!only) $convertTypedMentions(candidates);
      return;
    }
  }
}
