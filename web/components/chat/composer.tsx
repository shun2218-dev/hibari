"use client";

import { type KeyboardEvent, useRef } from "react";

import { Button, IconButton, TextButton } from "@/components/ui/button";
import { CheckCircleIcon, CloseIcon, FileIcon, PaperclipIcon } from "@/components/ui/icons";

import type { AttachmentDraftView } from "./types";

type ComposerProps = {
  value: string;
  onChange?: (value: string) => void;
  onSend?: () => void;
  /** 「ファイルを添付」で選んだファイル。 */
  onSelectFiles?: (files: File[]) => void;
  /** 入力中のほかのメンバーの表示名。 */
  typingNames?: string[];
  attachments?: AttachmentDraftView[];
  onRetryAttachment?: (id: string) => void;
  onRemoveAttachment?: (id: string) => void;
  /** 送信できる内容があるか（本文が空白だけ、アップロード中の添付がある、などは false）。 */
  canSend: boolean;
  /** スレッドのパネルの入力欄か。同じ画面に 2 つ並ぶので、読み上げの名前と案内を分ける（ADR 0036）。 */
  target?: "room" | "thread";
};

export function Composer({
  value,
  onChange,
  onSend,
  onSelectFiles,
  typingNames = [],
  attachments = [],
  onRetryAttachment,
  onRemoveAttachment,
  canSend,
  target = "room",
}: ComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // IME の変換を確定する Enter では送らない
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend?.();
    }
  }

  return (
    <div className="border-t border-border px-3 pt-2 pb-2 md:px-4">
      <TypingIndicator names={typingNames} />
      {attachments.length > 0 && (
        <ul aria-label="添付ファイル" className="flex flex-wrap gap-2 pb-2">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <AttachmentChip
                attachment={attachment}
                onRetry={() => onRetryAttachment?.(attachment.id)}
                onRemove={() => onRemoveAttachment?.(attachment.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <div
        className="flex items-end gap-1 rounded-md border border-border bg-surface p-2 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary"
      >
        <IconButton label="ファイルを添付" onClick={() => fileInput.current?.click()}>
          <PaperclipIcon className="size-4" />
        </IconButton>
        {/* 見た目はボタンで出し、ファイルの選択はブラウザの標準の画面に任せる */}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            // 同じファイルをもう一度選んでも change が起きるように空にする
            e.target.value = "";
            if (files.length > 0) onSelectFiles?.(files);
          }}
        />
        <textarea
          aria-label={target === "thread" ? "スレッドに返信" : "メッセージ"}
          rows={1}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={target === "thread" ? "スレッドに返信" : "メッセージを入力"}
          className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1 text-lg leading-normal text-text focus-visible:outline-none"
        />
        <Button size="sm" onClick={onSend} disabled={!canSend}>
          送信
        </Button>
      </div>
      <p className="pt-1.5 text-right text-2xs text-text-muted">Enter で送信 / Shift + Enter で改行</p>
    </div>
  );
}

/**
 * 入力中の表示。誰も入力していなくても高さを確保し、表示の出入りで入力欄が上下に動かないようにする。
 */
export function TypingIndicator({ names }: { names: string[] }) {
  return (
    <p aria-live="polite" className="flex h-6 items-center gap-1 text-xs text-attention-text">
      {names.length > 0 && (
        <>
          <span>{names.join("、")} が入力中</span>
          <span aria-hidden className="inline-flex gap-1 pl-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1 animate-typing-dot rounded-full bg-attention"
                // 3 つの点を 0.2 秒ずつずらして点滅させる（docs/ui/tokens.md）
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </span>
        </>
      )}
    </p>
  );
}

export function AttachmentChip({
  attachment,
  onRetry,
  onRemove,
}: {
  attachment: AttachmentDraftView;
  onRetry?: () => void;
  onRemove?: () => void;
}) {
  switch (attachment.status) {
    case "uploading":
      return (
        <div className="flex w-60 items-center gap-2.5 rounded-md border border-border bg-surface py-2 pr-1.5 pl-3">
          <FileIcon className="size-4 shrink-0 text-text-secondary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-medium text-text">{attachment.fileName}</p>
              <span className="font-mono text-2xs text-attention-text">{attachment.progress}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={`${attachment.fileName} をアップロード中`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={attachment.progress}
              className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted"
            >
              <div className="h-full rounded-full bg-attention" style={{ width: `${attachment.progress}%` }} />
            </div>
          </div>
          <IconButton label="アップロードを取り消す" onClick={onRemove}>
            <CloseIcon className="size-4" />
          </IconButton>
        </div>
      );
    case "failed":
      return (
        <div className="flex items-center gap-3 rounded-md border border-danger bg-danger-subtle px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">{attachment.fileName}</p>
            <p role="alert" className="text-2xs text-danger">
              アップロードできませんでした
            </p>
          </div>
          <TextButton onClick={onRetry} className="text-xs font-semibold">
            再試行
          </TextButton>
          <TextButton onClick={onRemove} className="text-xs text-text-secondary">
            取り消し
          </TextButton>
        </div>
      );
    case "uploaded":
      return (
        <div className="flex w-60 items-center gap-2.5 rounded-md border border-border bg-surface py-2 pr-1.5 pl-3">
          <CheckCircleIcon aria-label="アップロード済み" aria-hidden={false} role="img" className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text">{attachment.fileName}</p>
            <p className="font-mono text-2xs text-text-muted">{attachment.sizeLabel}</p>
          </div>
          <IconButton label="添付を外す" onClick={onRemove}>
            <CloseIcon className="size-4" />
          </IconButton>
        </div>
      );
  }
}
