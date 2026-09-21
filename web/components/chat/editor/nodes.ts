import { CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { QuoteNode } from "@lexical/rich-text";
import type { Klass, LexicalNode } from "lexical";

import { MentionNode } from "./mention-node";

/**
 * 入力欄に登録するノード（ADR 0052 決定 5）。ADR 0051 の記法で書けるものだけにする。
 * 見出しや表のノードを登録しないので、貼り付けた見出しは段落に、表はセルごとの段落になる。
 */
export const editorNodes: ReadonlyArray<Klass<LexicalNode>> = [ListNode, ListItemNode, QuoteNode, CodeNode, LinkNode, MentionNode];
