"use client";

import { $isCodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { IS_APPLE, mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_NORMAL,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from "lexical";
import { type RefObject, useEffect, useEffectEvent } from "react";

import { $exportBody } from "@/components/chat/editor/export";
import { applyFormat } from "@/components/chat/editor/toolbar";
import type { ChannelTable } from "@/lib/chat/format/channel-links";
import type { MentionCandidate } from "@/lib/chat/format/mentions";

import { $convertTypedChannels, $convertTypedMentions } from "./typed-mentions";

/** Shift 付きのショートカット（Slack の公式の一覧。ADR 0052 の追記の表）。キーの位置（code）で見る。Shift + 9 は "(" になるため。 */
function shortcutAction(event: KeyboardEvent) {
  switch (event.code) {
    case "KeyX":
      return "strikethrough";
    case "KeyU":
      return "link";
    case "KeyC":
      return event.altKey ? "codeBlock" : "code";
    case "Digit9":
      return "quote";
    case "Digit8":
      return "bulletList";
    case "Digit7":
      return "orderedList";
    default:
      return null;
  }
}

/**
 * キーの操作（ADR 0052 決定 5 / 6 と追記）。
 *
 * - Enter で送信（編集欄では保存）。Shift + Enter で改行（リストでは次の項目、コードブロックでは行の中の改行）
 * - Esc（編集欄のキャンセル）
 * - 書式のショートカット。⌘B / ⌘I / ⌘U は Lexical が扱うので、それ以外をここで受ける
 * - `@` の補完が開いている間の Enter と Esc は補完に任せる
 */
export function KeyboardPlugin({
  onSubmit,
  onEscape,
  menuOpenRef,
  onOpenLink,
  mentionCandidates,
  channels,
}: {
  /** 送る本文（送る形のテキスト）を渡す。親の値はまだ届いていないことがある（送信の直前にメンションを変えるため）。 */
  onSubmit?: (value: string) => void;
  mentionCandidates?: readonly MentionCandidate[];
  /** 末尾に残った `#名前` をリンクにするためのチャンネルの表（ADR 0062）。 */
  channels?: ChannelTable;
  onEscape?: () => void;
  menuOpenRef: RefObject<boolean>;
  onOpenLink: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  // 呼ぶ側の関数は毎回作り直されるので、購読はそのままに最新の関数を呼ぶ
  const submit = useEffectEvent(() => {
    // 末尾に残った `@ハンドル` と `#名前` もチップにしてから送る（ADR 0043、0062）
    const candidates = mentionCandidates;
    if (candidates) editor.update(() => $convertTypedMentions(candidates), { discrete: true });
    const table = channels;
    if (table) editor.update(() => $convertTypedChannels(table), { discrete: true });
    onSubmit?.(editor.getEditorState().read(() => $exportBody()));
  });
  const escape = useEffectEvent(() => onEscape?.());
  const openLink = useEffectEvent(() => onOpenLink());
  const canEscape = onEscape !== undefined;
  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            // IME の変換を確定する Enter と、補完を確定する Enter は拾わない
            if (menuOpenRef.current || event?.isComposing || editor.isComposing()) return false;
            event?.preventDefault();
            if (event?.shiftKey) {
              const inCode = editor.getEditorState().read(() => {
                const selection = $getSelection();
                return $isRangeSelection(selection) && $isCodeNode(selection.anchor.getNode().getTopLevelElement());
              });
              editor.dispatchCommand(inCode ? INSERT_LINE_BREAK_COMMAND : INSERT_PARAGRAPH_COMMAND, inCode ? false : undefined);
              return true;
            }
            submit();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          () => {
            if (menuOpenRef.current || !canEscape) return false;
            escape();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_DOWN_COMMAND,
          (event) => {
            const mod = IS_APPLE ? event.metaKey : event.ctrlKey;
            if (!mod || !event.shiftKey) return false;
            const action = shortcutAction(event);
            if (!action) return false;
            event.preventDefault();
            if (action === "link") openLink();
            else applyFormat(editor, action);
            return true;
          },
          COMMAND_PRIORITY_NORMAL,
        ),
      ),
    [editor, menuOpenRef, canEscape],
  );
  return null;
}
