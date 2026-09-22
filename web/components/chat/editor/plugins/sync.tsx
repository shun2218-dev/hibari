"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { type RefObject, useEffect, useEffectEvent } from "react";

import { $exportBody } from "@/components/chat/editor/export";
import { $importBody } from "@/components/chat/editor/import";

/** 読み込み直したときの更新に付ける印。書き出しの通知を出さない（呼ぶ側から来た値を返さない）ために使う。 */
export const SYNC_TAG = "hibari-sync";

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
