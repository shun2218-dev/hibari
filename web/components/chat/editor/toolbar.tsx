"use client";

import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $isLinkNode } from "@lexical/link";
import { $isListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListNode, REMOVE_LIST_COMMAND } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createQuoteNode, $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $getNearestNodeOfType, IS_APPLE } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
} from "lexical";
import { type ComponentType, useEffect, useState, useSyncExternalStore } from "react";

import {
  BoldIcon,
  BulletListIcon,
  CodeBlockIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  OrderedListIcon,
  QuoteIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "@/components/ui/icons";
import { cx } from "@/lib/cx";

/**
 * 入力欄の書式のツールバー（ADR 0052 決定 5 と追記）。
 *
 * 並びは Slack の書式のツールバー（太字・イタリック体・下線・取り消し線・コード・ブロック引用・コードブロック・順序付きリスト・箇条書き）に
 * リンクを加えたもの。ボタンのラベルにはショートカットを添える（Slack の公式の一覧のとおり。Windows / Linux は ⌘ を Ctrl に読み替える）。
 * 押したときに入力欄のキャレットを失わないよう、押し下げでフォーカスを奪わない。
 */
export type FormatAction =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "link"
  | "code"
  | "quote"
  | "codeBlock"
  | "orderedList"
  | "bulletList";

type ToolbarItem = { action: FormatAction; label: string; keys: (mod: string, alt: string) => string; Icon: ComponentType<{ className?: string }> };

const ITEMS: ToolbarItem[][] = [
  [
    { action: "bold", label: "太字", keys: (m) => `${m} B`, Icon: BoldIcon },
    { action: "italic", label: "斜体", keys: (m) => `${m} I`, Icon: ItalicIcon },
    { action: "underline", label: "下線", keys: (m) => `${m} U`, Icon: UnderlineIcon },
    { action: "strikethrough", label: "取り消し線", keys: (m) => `${m} Shift X`, Icon: StrikethroughIcon },
  ],
  [
    { action: "link", label: "リンク", keys: (m) => `${m} Shift U`, Icon: LinkIcon },
    { action: "code", label: "コード", keys: (m) => `${m} Shift C`, Icon: CodeIcon },
  ],
  [
    { action: "quote", label: "引用", keys: (m) => `${m} Shift 9`, Icon: QuoteIcon },
    { action: "codeBlock", label: "コードブロック", keys: (m, a) => `${m} ${a} Shift C`, Icon: CodeBlockIcon },
    { action: "orderedList", label: "番号付きリスト", keys: (m) => `${m} Shift 7`, Icon: OrderedListIcon },
    { action: "bulletList", label: "箇条書き", keys: (m) => `${m} Shift 8`, Icon: BulletListIcon },
  ],
];

const noSubscribe = () => () => {};

/**
 * Mac かどうか。サーバーでの描画では分からないので false（Ctrl）で描き、ブラウザで描き直す
 * （モジュールの読み込み時に決めると、サーバーとブラウザで文言がずれて hydration が合わない）。
 */
function useIsApple(): boolean {
  return useSyncExternalStore(noSubscribe, () => IS_APPLE, () => false);
}

/** いまのキャレットの位置で効いている書式。ボタンを押された状態に見せるのに使う。 */
type ActiveFormats = ReadonlySet<FormatAction>;

export function Toolbar({ onOpenLink, disabled = false }: { onOpenLink: () => void; disabled?: boolean }) {
  const [editor] = useLexicalComposerContext();
  const active = useActiveFormats(editor);
  const apple = useIsApple();
  const mod = apple ? "⌘" : "Ctrl";
  const alt = apple ? "⌥" : "Alt";
  return (
    <div role="toolbar" aria-label="書式" className="flex items-center gap-0.5 overflow-x-auto pb-1">
      {ITEMS.map((group, i) => (
        <div key={i} className={cx("flex items-center gap-0.5", i > 0 && "border-l border-border pl-0.5")}>
          {group.map(({ action, label, keys, Icon }) => (
            <button
              key={action}
              type="button"
              aria-label={`${label}（${keys(mod, alt)}）`}
              title={`${label}（${keys(mod, alt)}）`}
              aria-pressed={active.has(action)}
              disabled={disabled}
              // 押し下げでフォーカスを奪うと、入力欄の選択範囲が消えて書式を当てる先がなくなる
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (action === "link" ? onOpenLink() : applyFormat(editor, action))}
              className={cx(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-text-muted",
                active.has(action) && "bg-surface-muted text-text",
              )}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 書式を当てる・外す（ツールバーとショートカットの両方から呼ぶ）。リンクは呼ぶ側が画面を開く。 */
export function applyFormat(editor: LexicalEditor, action: Exclude<FormatAction, "link">): void {
  switch (action) {
    case "bold":
    case "italic":
    case "underline":
    case "strikethrough":
    case "code":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, action);
      return;
    case "orderedList":
    case "bulletList": {
      const type = action === "orderedList" ? "number" : "bullet";
      const current = editor.getEditorState().read(() => currentListType());
      if (current === type) editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      else editor.dispatchCommand(type === "number" ? INSERT_ORDERED_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND, undefined);
      return;
    }
    case "quote":
    case "codeBlock":
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const block = selection.anchor.getNode().getTopLevelElement();
        const isSame = action === "quote" ? $isQuoteNode(block) : $isCodeNode(block);
        // もう一度押したら段落に戻す
        $setBlocksType(selection, () => (isSame ? $createParagraphNode() : action === "quote" ? $createQuoteNode() : $createCodeNode()));
      });
      return;
  }
}

function currentListType(): "number" | "bullet" | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const list = $getNearestNodeOfType(selection.anchor.getNode(), ListNode);
  return $isListNode(list) ? (list.getListType() === "number" ? "number" : "bullet") : null;
}

function useActiveFormats(editor: LexicalEditor): ActiveFormats {
  const [active, setActive] = useState<ActiveFormats>(new Set());
  useEffect(() => {
    const read = () =>
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        const next = new Set<FormatAction>();
        if ($isRangeSelection(selection)) {
          for (const f of ["bold", "italic", "underline", "strikethrough", "code"] as const) if (selection.hasFormat(f)) next.add(f);
          const node = selection.anchor.getNode();
          const block = node.getTopLevelElement();
          if ($isQuoteNode(block)) next.add("quote");
          if ($isCodeNode(block)) next.add("codeBlock");
          const list = currentListType();
          if (list === "number") next.add("orderedList");
          if (list === "bullet") next.add("bulletList");
          if ($isLinkNode(node.getParent()) || $isLinkNode(node)) next.add("link");
        }
        setActive((prev) => (sameSet(prev, next) ? prev : next));
      });
    const unregisterUpdate = editor.registerUpdateListener(read);
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        read();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      unregisterUpdate();
      unregisterSelection();
    };
  }, [editor]);
  return active;
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}
