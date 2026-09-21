"use client";

import { $isCodeNode, CodeNode } from "@lexical/code";
import { $isLinkNode, LinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalTypeaheadMenuPlugin, MenuOption, type TriggerFn } from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { IS_APPLE, mergeRegister } from "@lexical/utils";
import {
  $createTextNode,
  $getNodeByKey,
  $hasUpdateTag,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  BLUR_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
  COMPOSITION_END_TAG,
  HISTORIC_TAG,
  PASTE_TAG,
  type TextFormatType,
  TextNode,
} from "lexical";
import { type RefObject, useEffect, useEffectEvent, useLayoutEffect, useMemo, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Portal } from "@/components/ui/portal";
import { placeAboveCaret, type PanelPlacement } from "@/lib/anchored-position";
import { type Inline, parseInline } from "@/lib/chat/body-format";
import { candidateKey, filterCandidates, type MentionCandidate } from "@/lib/chat/mentions";
import { cx } from "@/lib/cx";

import { $exportBody } from "./export";
import { $importBody } from "./import";
import { $createMentionNode } from "./mention-node";
import { applyFormat } from "./toolbar";

/** 読み込み直したときの更新に付ける印。書き出しの通知を出さない（呼ぶ側から来た値を返さない）ために使う。 */
const SYNC_TAG = "hibari-sync";

/**
 * 外の値（送る形のテキスト）と入力欄をそろえる（ADR 0052 決定 3）。
 *
 * - 入力欄が変わったら書き出して onChange で返す
 * - 外の値を読み込み直すのは、最後に書き出した値と違うときだけ（送信後の空・編集の開始）。
 *   打つたびに読み込み直すと、キャレットの位置と IME の変換が壊れる
 */
export function SyncPlugin({
  value,
  names,
  lastValueRef,
  onChange,
}: {
  value: string;
  names: Readonly<Record<string, string>>;
  lastValueRef: RefObject<string>;
  onChange?: (value: string) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    editor.update(
      () => {
        $importBody(value, names);
        // 送信のあとの空は、続けて打てるようにキャレットを残す
        if (editor.getRootElement() === document.activeElement) $getRoot().selectEnd();
      },
      { tag: SYNC_TAG },
    );
  }, [editor, value, names, lastValueRef]);

  // 呼ぶ側は onChange を毎回作り直すことが多い。そのたびに購読し直さないよう、最新の関数だけを覚えておく
  const notify = useEffectEvent((next: string) => onChange?.(next));
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags, dirtyElements, dirtyLeaves }) => {
        if (tags.has(SYNC_TAG) || (dirtyElements.size === 0 && dirtyLeaves.size === 0)) return;
        const next = editorState.read(() => $exportBody());
        if (next === lastValueRef.current) return;
        lastValueRef.current = next;
        notify(next);
      }),
    [editor, lastValueRef],
  );
  return null;
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
}: {
  /** 送る本文（送る形のテキスト）を渡す。親の値はまだ届いていないことがある（送信の直前にメンションを変えるため）。 */
  onSubmit?: (value: string) => void;
  mentionCandidates?: readonly MentionCandidate[];
  onEscape?: () => void;
  menuOpenRef: RefObject<boolean>;
  onOpenLink: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  // 呼ぶ側の関数は毎回作り直されるので、購読はそのままに最新の関数を呼ぶ
  const submit = useEffectEvent(() => {
    // 末尾に残った `@ハンドル` もメンションにしてから送る（ADR 0043）
    const candidates = mentionCandidates;
    if (candidates) editor.update(() => $convertTypedMentions(candidates), { discrete: true });
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

const INLINE_MARKERS = ["__", "*", "_", "~", "`"] as const;
const FORMAT_OF: Readonly<Record<string, TextFormatType>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikethrough",
  code: "code",
};

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

// ---- `@` の補完（ADR 0052 決定 4） ----

class MentionOption extends MenuOption {
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

/**
 * 補完の候補。キャレットの上に出す（下は入力欄の外で切れる）。位置は `placeAboveCaret` で決め、Portal で body の直下に置く。
 * 候補の見た目は textarea のときと同じ（ADR 0043）。
 */
function MentionMenu({
  options,
  active,
  onChoose,
  onHighlight,
  editor,
}: {
  options: MentionOption[];
  active: number;
  onChoose: (option: MentionOption) => void;
  onHighlight: (index: number) => void;
  editor: LexicalEditor;
}) {
  const [menu, setMenu] = useState<HTMLUListElement | null>(null);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);

  useLayoutEffect(() => {
    if (!menu) return;
    const place = () => {
      const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect();
      const root = editor.getRootElement()?.getBoundingClientRect();
      // 空の行ではキャレットの矩形が取れないので、入力欄の左上を使う
      const caret = rect && rect.height > 0 ? rect : root;
      if (!caret) return;
      setPlacement(
        placeAboveCaret(caret, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
      );
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [editor, menu, options.length]);

  return (
    <Portal>
      <ul
        ref={setMenu}
        aria-label="メンションの候補"
        role="listbox"
        style={placement === null ? { top: 0, left: 0, opacity: 0 } : { top: placement.top, left: placement.left }}
        className="fixed z-50 max-h-64 w-72 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-overlay"
      >
        {options.map((option, i) => {
          const candidate = option.candidate;
          return (
            <li key={option.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                tabIndex={-1}
                // 押し下げでフォーカスを奪うと、入力欄のキャレットが消えて差し込む先がなくなる
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChoose(option);
                }}
                onMouseEnter={() => onHighlight(i)}
                className={cx("flex w-full items-center gap-2 px-3 py-1.5 text-left", i === active && "bg-surface-muted")}
              >
                {candidate.kind === "user" ? (
                  <>
                    <Avatar id={candidate.id} name={candidate.name} imageUrl={candidate.avatarUrl} size="sm" />
                    <span className="truncate text-base font-semibold text-text">{candidate.name}</span>
                    <span className="truncate text-xs text-text-muted">@{candidate.handle}</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center text-base font-semibold text-text-secondary">
                      @
                    </span>
                    <span className="text-base font-semibold text-text">@{candidate.kind}</span>
                    <span className="truncate text-xs text-text-muted">{candidate.description}</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Portal>
  );
}

