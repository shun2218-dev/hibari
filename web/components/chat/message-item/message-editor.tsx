"use client";

import { RichTextInput } from "@/components/chat/editor/rich-text-input";
import { Button } from "@/components/ui/button";

import type { MessageEditingView } from "./message-item";

/**
 * その場での編集（ADR 0027）。入力欄と同じ書式のまま直す。
 */
/** 本文をその場で書き換える。Enter で保存、Esc で取りやめ（改行は Shift + Enter）。 */
export function MessageEditor({ editing, mentionNames }: { editing: MessageEditingView; mentionNames?: Readonly<Record<string, string>> }) {
  return (
    <div className="flex flex-col gap-1.5 pt-0.5">
      {/* 入力欄と同じリッチテキストの欄（ADR 0052）。編集ではツールバーを出さず、記号の入力とショートカットで書式を付ける */}
      <div className="rounded-md border border-border bg-surface px-1.5 py-1 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary">
        <RichTextInput
          value={editing.value}
          onChange={editing.onChange}
          onSubmit={() => {
            if (editing.value.trim() !== "") editing.onSave?.();
          }}
          onEscape={editing.onCancel}
          mentionNames={mentionNames}
          mentionCandidates={editing.mentionCandidates}
          toolbar={false}
          label="メッセージを編集"
          autoFocus
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xs text-text-muted">Enter で保存 / Esc でキャンセル</span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={editing.onCancel}>
            キャンセル
          </Button>
          <Button size="sm" onClick={editing.onSave} disabled={editing.saving || editing.value.trim() === ""}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
