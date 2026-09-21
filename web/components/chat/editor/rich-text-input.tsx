"use client";

import { $createLinkNode, $isLinkNode } from "@lexical/link";
import { CODE, ORDERED_LIST, QUOTE, UNORDERED_LIST } from "@lexical/markdown";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { type InitialConfigType, LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $createTextNode, $getSelection, $isRangeSelection, $setSelection, type BaseSelection } from "lexical";
import { type ReactNode, useCallback, useRef, useState } from "react";

import type { MentionCandidate } from "@/lib/chat/mentions";

import { $importBody } from "./import";
import { LinkDialog } from "./link-dialog";
import { editorNodes } from "./nodes";
import { InlineMarkdownPlugin, KeyboardPlugin, MentionPlugin, SanitizePlugin, SyncPlugin } from "./plugins";
import { Toolbar } from "./toolbar";

/**
 * リッチテキストの入力欄（ADR 0052）。入力欄（Composer）とメッセージの編集欄が使う。
 *
 * 値は**送る形のテキスト**（ADR 0051 の記法。メンションはトークン）で受け取り、変わるたびに同じ形で返す（決定 3）。
 * Lexical の状態は中に閉じ込め、外に出さない。
 */
export type RichTextInputProps = {
  value: string;
  onChange?: (value: string) => void;
  /** Enter（送信・保存）。送る本文を渡す（送信の直前に手で打った `@ハンドル` をメンションにするので、親の値より新しい）。 */
  onSubmit?: (value: string) => void;
  /** Esc（編集欄のキャンセル）。 */
  onEscape?: () => void;
  /** 本文の `<@ID>` を `@名前` のチップにするための表（編集欄で既存の本文を読み込むとき）。 */
  mentionNames?: Readonly<Record<string, string>>;
  /** `@` の補完の候補。渡さなければ補完は開かない。 */
  mentionCandidates?: readonly MentionCandidate[];
  /** 書式のツールバーを出すか（ADR 0052 の追記）。 */
  toolbar?: boolean;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** 入力欄の下の段（添付・ツールバーの切り替え・送信）。Slack と同じく、ツールバー・入力・操作の 3 段にする。 */
  footer?: ReactNode;
  /** story で補完を開いた状態を出す。 */
  forceMentionQuery?: string;
  /** story でリンクの画面を開いた状態を出す。 */
  forceLinkDialog?: { text: string; url: string };
};

/** 書式の見た目。本文の表示（message-body.tsx）と同じトークンにそろえる。 */
const theme: InitialConfigType["theme"] = {
  paragraph: "whitespace-pre-wrap",
  quote: "border-l-4 border-border pl-3 text-text-secondary",
  code: "block overflow-x-auto rounded-sm border border-border bg-surface-muted px-3 py-2 font-mono text-base leading-normal whitespace-pre text-text",
  link: "text-primary",
  list: {
    ul: "list-disc pl-6",
    ol: "list-decimal pl-6",
    listitem: "pl-1",
    // 入れ子のリストだけを持つ項目には記号を出さない（import.ts）
    nested: { listitem: "list-none" },
    ulDepth: ["list-disc pl-6", "list-circle pl-6", "list-square pl-6"],
    olDepth: ["list-decimal pl-6", "list-decimal pl-6", "list-decimal pl-6"],
  },
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    underlineStrikethrough: "underline-strike",
    code: "rounded-sm border border-border bg-surface-muted px-1 font-mono text-base text-code-text",
  },
};

/** 行頭の `> ` `- ` `1. ` ` ``` ` で引用・リスト・コードブロックにする（ADR 0052 決定 5）。インラインの記号は InlineMarkdownPlugin。 */
const BLOCK_SHORTCUTS = [QUOTE, UNORDERED_LIST, ORDERED_LIST, CODE];

export function RichTextInput(props: RichTextInputProps) {
  const { value, mentionNames } = props;
  // 最初の中身は、初めて描くときの値で作る（あとから変わった値は SyncPlugin が読み込む）
  const [initialConfig] = useState<InitialConfigType>(() => ({
    namespace: "hibari-composer",
    nodes: [...editorNodes],
    theme,
    onError: (error: Error) => {
      throw error;
    },
    editorState: () => $importBody(value, mentionNames ?? {}),
  }));
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <Editor {...props} />
    </LexicalComposer>
  );
}

const noNames: Readonly<Record<string, string>> = {};

function Editor({
  value,
  onChange,
  onSubmit,
  onEscape,
  mentionNames = noNames,
  mentionCandidates,
  toolbar = true,
  label,
  placeholder,
  autoFocus,
  footer,
  forceMentionQuery,
  forceLinkDialog,
}: RichTextInputProps) {
  const [editor] = useLexicalComposerContext();
  const lastValueRef = useRef(value);
  const menuOpenRef = useRef(false);
  // リンクの画面。開くたびに作り直す（key）ので、中の入力は前の値を持ち越さない
  const [linkDialog, setLinkDialog] = useState<{ key: number; text: string; url: string } | null>(
    forceLinkDialog ? { key: 0, ...forceLinkDialog } : null,
  );
  // 画面を開くと入力欄の選択が外れるので、開く前の選択を覚えておき、保存のときに戻して差し込む
  const savedSelection = useRef<BaseSelection | null>(null);

  const openLink = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      savedSelection.current = selection?.clone() ?? null;
      let text = "";
      let url = "";
      if ($isRangeSelection(selection)) {
        text = selection.getTextContent();
        const parent = selection.anchor.getNode().getParent();
        if ($isLinkNode(parent)) url = parent.getURL();
      }
      setLinkDialog((current) => ({ key: (current?.key ?? 0) + 1, text, url }));
    });
  }, [editor]);

  const saveLink = ({ text, url }: { text: string; url: string }) => {
    setLinkDialog(null);
    editor.update(() => {
      if (savedSelection.current) $setSelection(savedSelection.current.clone());
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      selection.insertNodes([$createLinkNode(url).append($createTextNode(text))]);
    });
    editor.focus();
  };

  return (
    <div className="flex flex-col">
      {toolbar && <Toolbar onOpenLink={openLink} />}
      <div className="relative min-w-0">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                aria-label={label}
                aria-placeholder={placeholder ?? ""}
                placeholder={
                  <p className="pointer-events-none absolute top-1 left-1.5 text-lg leading-normal text-text-muted select-none">
                    {placeholder}
                  </p>
                }
                className="composer-lines min-h-8 overflow-y-auto px-1.5 py-1 text-lg leading-normal break-words text-text focus-visible:outline-none"
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
      </div>
      {footer}
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <MarkdownShortcutPlugin transformers={BLOCK_SHORTCUTS} />
      <InlineMarkdownPlugin />
      <SanitizePlugin />
      <SyncPlugin value={value} names={mentionNames} lastValueRef={lastValueRef} onChange={onChange} />
      <KeyboardPlugin
        onSubmit={onSubmit}
        onEscape={onEscape}
        menuOpenRef={menuOpenRef}
        onOpenLink={openLink}
        mentionCandidates={mentionCandidates}
      />
      {mentionCandidates && <MentionPlugin candidates={mentionCandidates} menuOpenRef={menuOpenRef} forceQuery={forceMentionQuery} />}
      {autoFocus && <AutoFocusPlugin defaultSelection="rootEnd" />}
      {linkDialog && (
        <LinkDialog
          key={linkDialog.key}
          open
          initialText={linkDialog.text}
          initialUrl={linkDialog.url}
          onCancel={() => {
            setLinkDialog(null);
            editor.focus();
          }}
          onSave={saveLink}
        />
      )}
    </div>
  );
}
