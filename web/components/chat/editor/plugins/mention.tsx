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
import { type ChannelRef, type ChannelTable, filterChannels } from "@/lib/chat/format/channel-links";
import { candidateKey, filterCandidates, type MentionCandidate } from "@/lib/chat/format/mentions";

import { MentionMenu } from "./mention-menu";
import { SYNC_TAG } from "./sync";
import { $convertTypedChannels, $convertTypedMentions } from "./typed-mentions";

// ---- `@` と `#` の補完（ADR 0052 決定 4、ADR 0062 決定 4） ----

/** 補完の 1 件。`@` はメンション、`#` はチャンネルへのリンク。 */
export type Suggestion = { type: "mention"; candidate: MentionCandidate } | { type: "channel"; channel: ChannelRef };

export class MentionOption extends MenuOption {
  constructor(readonly suggestion: Suggestion) {
    super(suggestion.type === "mention" ? candidateKey(suggestion.candidate) : `#${suggestion.channel.id}`);
  }
}

/**
 * 補完を開く文字。行頭か空白の直後の `@` / `#` だけを見る（メールアドレスの `@`、URL の `#` で開かない。ADR 0043、0062）。
 * `@` の後ろはハンドルに使える文字、`#` の後ろは空白までの何でも（チャンネルの名前は日本語でもよい）。
 */
const TRIGGER = /(^|\s)(?:@([A-Za-z0-9_]{0,32})|#([^\s#]{0,80}))$/u;

type Query = { kind: "@" | "#"; text: string };

const trigger: TriggerFn = (text) => {
  const m = TRIGGER.exec(text);
  if (!m) return null;
  // コードの中では開かない（コードの中のトークンはメンションにならない。ADR 0051 決定 5）
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    const node = selection.anchor.getNode();
    if (($isTextNode(node) && node.hasFormat("code")) || $isCodeNode(node.getTopLevelElement())) return null;
  }
  // 補完には打った文字しか渡らないので、どちらの記号かを先頭の 1 文字に残す
  const [mark, typed] = m[2] !== undefined ? ["@", m[2]] : ["#", m[3]];
  return { leadOffset: m.index + m[1].length, matchingString: `${mark}${typed}`, replaceableString: `${mark}${typed}` };
};

function parseQuery(matching: string | null): Query | null {
  if (matching === null) return null;
  return { kind: matching.startsWith("#") ? "#" : "@", text: matching.slice(1) };
}

export function MentionPlugin({
  candidates,
  channels,
  menuOpenRef,
  forceQuery,
}: {
  candidates: readonly MentionCandidate[];
  /** `#` の補完と、手で打った `#名前` に使うチャンネルの表（ADR 0062）。 */
  channels: ChannelTable;
  menuOpenRef: RefObject<boolean>;
  /** story で補完を開いた状態を出す。入力欄の末尾にこの文字を入れる（`#` で始めればチャンネル、それ以外は `@` を前に付ける）。 */
  forceQuery?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<Query | null>(null);
  const options = useMemo(() => {
    if (query === null) return [];
    if (query.kind === "#") return filterChannels(channels, query.text).map((channel) => new MentionOption({ type: "channel", channel }));
    return filterCandidates(candidates, query.text).map((candidate) => new MentionOption({ type: "mention", candidate }));
  }, [candidates, channels, query]);

  // 手で打った `@ハンドル` と `#名前` を、後ろに空白や句読点を打った時点でチップにする
  useEffect(
    () =>
      editor.registerNodeTransform(TextNode, (node) => {
        if ($hasUpdateTag(PASTE_TAG) || $hasUpdateTag(HISTORIC_TAG) || $hasUpdateTag(SYNC_TAG) || editor.isComposing()) return;
        $convertTypedMentions(candidates, node);
        // メンションの変換でノードが置き換わっていたら、残りは次の変換（ノードが変わると呼ばれる）で見る
        if (node.isAttached()) $convertTypedChannels(channels, node);
      }),
    [editor, candidates, channels],
  );

  // 送信ボタンを押すときは入力欄からフォーカスが外れる。そこで末尾の `@ハンドル` と `#名前` も変えておく（Enter は KeyboardPlugin）
  useEffect(
    () =>
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          editor.update(() => {
            $convertTypedMentions(candidates);
            $convertTypedChannels(channels);
          });
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, candidates, channels],
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
      // `@` / `#` は行頭か空白の直後でないと補完が開かないので、前に文字があれば空白をはさむ
      const before = paragraph.getTextContent();
      const typed = forceQuery.startsWith("#") ? forceQuery : `@${forceQuery}`;
      const text = $createTextNode(`${before === "" || /\s$/u.test(before) ? "" : " "}${typed}`);
      paragraph.append(text);
      text.select();
    });
    editor.focus();
  }, [editor, forceQuery]);

  return (
    <LexicalTypeaheadMenuPlugin<MentionOption>
      triggerFn={trigger}
      onQueryChange={(matching) => setQuery(parseQuery(matching))}
      // Esc などで閉じたら、Enter を補完に任せるのをやめる（開き直すと onQueryChange がまた呼ばれる）
      onClose={() => setQuery(null)}
      options={options}
      onSelectOption={(option, nodeToReplace, closeMenu) => {
        editor.update(() => {
          const mention = suggestionNode(option.suggestion);
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

/** 選んだ候補のノード。チャンネルは private でも `#名前`（入力欄のチップは文字だけで描く。import.ts と同じ）。 */
function suggestionNode(suggestion: Suggestion) {
  if (suggestion.type === "channel") {
    const { id, name } = suggestion.channel;
    return $createMentionNode(`<#${id}>`, `#${name}`);
  }
  const c = suggestion.candidate;
  return c.kind === "user" ? $createMentionNode(`<@${c.id}>`, `@${c.name}`) : $createMentionNode(`<!${c.kind}>`, `@${c.kind}`);
}
