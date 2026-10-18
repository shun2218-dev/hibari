import { act } from "@testing-library/react";
import { $getRoot, $getSelection, $isRangeSelection, CONTROLLED_TEXT_INSERTION_COMMAND, type LexicalEditor, PASTE_COMMAND } from "lexical";

import { $exportBody } from "./export";

/**
 * テストで入力欄に文字を打つ（ADR 0052）。
 *
 * jsdom は beforeinput の範囲（getTargetRanges）を持たないので、userEvent.type で打った文字を Lexical が受け取らない。
 * ブラウザで打ったときと同じ経路（CONTROLLED_TEXT_INSERTION_COMMAND）で 1 文字ずつ差し込む。
 * 1 文字ずつにするのは、記号の入力（`*太字*` の閉じる `*` で太字にする）と `@` の補完が、打つたびに判定するため。
 * Enter や Escape は userEvent.keyboard で押せる（Lexical はキーのイベントを受け取る）。
 */
export async function typeInEditor(element: HTMLElement, text: string): Promise<void> {
  const editor = editorOf(element);
  // 人が打つときは入力欄にフォーカスがある。Lexical はフォーカスがあるときだけ DOM の選択範囲を書き戻す
  await act(async () => element.focus());
  // jsdom は DOM の選択範囲を書き換えると selectionchange を同期で出す。Lexical はそれを人の操作として読み戻し、
  // 書式をキャレットの位置の文字から取り直してしまう（ブラウザでは非同期に届き、Lexical が自分の書き戻しとして無視する）。
  // 打っている間だけ止めて、ブラウザと同じ結果にする
  const swallow = (event: Event) => event.stopImmediatePropagation();
  document.addEventListener("selectionchange", swallow, true);
  try {
    await typeChars(editor, text);
  } finally {
    document.removeEventListener("selectionchange", swallow, true);
  }
}

async function typeChars(editor: LexicalEditor, text: string): Promise<void> {
  for (const char of text) {
    await act(async () => {
      editor.update(
        () => {
          if (!$isRangeSelection($getSelection())) $getRoot().selectEnd();
        },
        { discrete: true },
      );
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, char);
    });
  }
}

/** 入力欄（contenteditable の要素）から Lexical のエディタを取り出す。 */
export function editorOf(element: HTMLElement): LexicalEditor {
  const editor = (element as HTMLElement & { __lexicalEditor?: LexicalEditor }).__lexicalEditor;
  if (!editor) throw new Error("the element is not a Lexical editor");
  return editor;
}

/** 入力欄の中身を、送る形のテキスト（ADR 0052 決定 3）で読む。textarea の toHaveValue の代わり。 */
export function valueOf(element: HTMLElement): string {
  return editorOf(element)
    .getEditorState()
    .read(() => $exportBody());
}

/**
 * テストで入力欄に貼り付ける（ADR 0052 決定 5）。jsdom には DataTransfer がないので、クリップボードの中身だけを持つ形で渡す。
 * html を渡せば書式ごと、text だけならテキストとして貼る。
 */
export async function pasteInEditor(element: HTMLElement, data: { html?: string; text: string }): Promise<void> {
  const editor = editorOf(element);
  await act(async () => element.focus());
  const types = data.html === undefined ? ["text/plain"] : ["text/html", "text/plain"];
  const clipboardData = {
    types,
    files: [],
    items: [],
    getData: (type: string) => (type === "text/html" ? (data.html ?? "") : type === "text/plain" ? data.text : ""),
  };
  await act(async () => {
    editor.update(
      () => {
        if (!$isRangeSelection($getSelection())) $getRoot().selectEnd();
      },
      { discrete: true },
    );
    editor.dispatchCommand(PASTE_COMMAND, { clipboardData, preventDefault() {}, target: element } as unknown as ClipboardEvent);
  });
}

/** テストで入力欄を空にする（userEvent.clear の代わり）。 */
export async function clearEditor(element: HTMLElement): Promise<void> {
  const editor = editorOf(element);
  await act(async () => element.focus());
  await act(async () => {
    editor.update(
      () => {
        $getRoot().clear();
        $getRoot().selectEnd();
      },
      { discrete: true },
    );
  });
}
