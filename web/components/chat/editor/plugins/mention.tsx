"use client";

import { $isCodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalTypeaheadMenuPlugin, MenuOption, type TriggerFn } from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $hasUpdateTag,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  HISTORIC_TAG,
  PASTE_TAG,
  TextNode,
} from "lexical";
import { type RefObject, useEffect, useMemo, useState } from "react";

import { $createMentionNode } from "@/components/chat/editor/mention-node";
import { candidateKey, filterCandidates, type MentionCandidate } from "@/lib/chat/format/mentions";

import { MentionMenu } from "./mention-menu";
import { SYNC_TAG } from "./sync";
import { $convertTypedMentions } from "./typed-mentions";

// ---- `@` の補完（ADR 0052 決定 4） ----

export class MentionOption extends MenuOption {
  constructor(readonly candidate: MentionCandidate) {
    super(candidateKey(candidate));
  }
}

/** `@` の後ろに打ったハンドル。行頭か空白の直後の `@` だけを見る（メールアドレスの `@` で開かない。ADR 0043）。 */
const MENTION_TRIGGER = /(^|\s)@([A-Za-z0-9_]{0,32})$/u;

const trigger: TriggerFn = (text) => {
  const m = MENTION_TRIGGER.exec(text);
  if (!m) return null;
  // コードの中では開かない（コードの中のトークンはメンションにならない。ADR 0051 決定 5）
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    const node = selection.anchor.getNode();
    if (($isTextNode(node) && node.hasFormat("code")) || $isCodeNode(node.getTopLevelElement())) return null;
  }
  return { leadOffset: m.index + m[1].length, matchingString: m[2], replaceableString: `@${m[2]}` };
};

export function MentionPlugin({
  candidates,
  menuOpenRef,
  forceQuery,
}: {
  candidates: readonly MentionCandidate[];
  menuOpenRef: RefObject<boolean>;
  /** story で補完を開いた状態を出す。入力欄の末尾に `@` とこの文字を入れる。 */
  forceQuery?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const options = useMemo(
    () => (query === null ? [] : filterCandidates(candidates, query).map((c) => new MentionOption(c))),
    [candidates, query],
  );

  // 手で打った `@ハンドル` を、後ろに空白や句読点を打った時点でチップにする
  useEffect(
    () =>
      editor.registerNodeTransform(TextNode, (node) => {
        if ($hasUpdateTag(PASTE_TAG) || $hasUpdateTag(HISTORIC_TAG) || $hasUpdateTag(SYNC_TAG) || editor.isComposing()) return;
        $convertTypedMentions(candidates, node);
      }),
    [editor, candidates],
  );

  // 送信ボタンを押すときは入力欄からフォーカスが外れる。そこで末尾の `@ハンドル` も変えておく（Enter は KeyboardPlugin）
  useEffect(
    () =>
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          editor.update(() => $convertTypedMentions(candidates));
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, candidates],
  );

  // Enter / Esc を補完に任せるかどうか。候補がないのに開いている扱いにすると、Enter で送れなくなる
  useEffect(() => {
    menuOpenRef.current = query !== null && options.length > 0;
  }, [menuOpenRef, options, query]);

  useEffect(() => {
    if (forceQuery === undefined) return;
    editor.update(() => {
      const paragraph = $getRoot().getLastChild();
      if (!$isElementNode(paragraph)) return;
      // `@` は行頭か空白の直後でないと補完が開かないので、前に文字があれば空白をはさむ
      const before = paragraph.getTextContent();
      const text = $createTextNode(`${before === "" || /\s$/u.test(before) ? "" : " "}@${forceQuery}`);
      paragraph.append(text);
      text.select();
    });
    editor.focus();
  }, [editor, forceQuery]);

  return (
    <LexicalTypeaheadMenuPlugin<MentionOption>
      triggerFn={trigger}
      onQueryChange={setQuery}
      // Esc などで閉じたら、Enter を補完に任せるのをやめる（開き直すと onQueryChange がまた呼ばれる）
      onClose={() => setQuery(null)}
      options={options}
      onSelectOption={(option, nodeToReplace, closeMenu) => {
        editor.update(() => {
          const c = option.candidate;
          const mention =
            c.kind === "user" ? $createMentionNode(`<@${c.id}>`, `@${c.name}`) : $createMentionNode(`<!${c.kind}>`, `@${c.kind}`);
          if (nodeToReplace) nodeToReplace.replace(mention);
          else $getSelection()?.insertNodes([mention]);
          // 続けて書けるよう、後ろに空白を足してキャレットを置く（ADR 0043 と同じ）
          const space = $createTextNode(" ");
          mention.insertAfter(space);
          space.select(1, 1);
          closeMenu();
        });
      }}
      menuRenderFn={(_anchor, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex, options: shown }) =>
        shown.length === 0 ? null : (
          <MentionMenu
            options={shown}
            active={selectedIndex ?? 0}
            onChoose={selectOptionAndCleanUp}
            onHighlight={setHighlightedIndex}
            editor={editor}
          />
        )
      }
    />
  );
}
