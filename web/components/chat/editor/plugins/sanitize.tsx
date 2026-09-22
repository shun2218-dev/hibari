"use client";

import { $isCodeNode, CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { useEffect } from "react";

/**
 * 貼り付けで入ったものを、ADR 0051 の記法で書ける形に整える（ADR 0052 決定 5）。
 * - `<pre><code>` でできる二重のコードブロックを平らにする
 * - http / https でないリンクは文字だけにする
 */
export function SanitizePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      mergeRegister(
        editor.registerNodeTransform(CodeNode, (node) => {
          for (const child of node.getChildren()) {
            if ($isCodeNode(child)) {
              for (const grandchild of child.getChildren()) child.insertBefore(grandchild);
              child.remove();
            }
          }
        }),
        editor.registerNodeTransform(LinkNode, (node) => {
          if (/^https?:\/\//u.test(node.getURL())) return;
          for (const child of node.getChildren()) node.insertBefore(child);
          node.remove();
        }),
      ),
    [editor],
  );
  return null;
}
