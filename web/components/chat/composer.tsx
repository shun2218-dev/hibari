"use client";

import { useMemo, useRef } from "react";

import { IconButton, TextButton } from "@/components/ui/button";
import { CheckCircleIcon, CloseIcon, FileIcon, PaperclipIcon, SendIcon } from "@/components/ui/icons";
import type { MentionCandidate } from "@/lib/chat/mentions";
import { cx } from "@/lib/cx";

import { RichTextInput } from "./editor/rich-text-input";
import type { AttachmentDraftView } from "./types";

type ComposerProps = {
  /** 送る形の本文（ADR 0051 の記法。メンションはトークン。ADR 0052 決定 3）。 */
  value: string;
  onChange?: (value: string) => void;
  /**
   * 送信。Enter のときは送る本文を渡す（入力欄が送信の直前に手で打った `@ハンドル` をメンションにするので、value より新しい）。
   * 送信ボタンのときは value がそのまま送る本文。
   */
  onSend?: (body?: string) => void;
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
  /**
   * スレッドの入力欄の「チャンネルにも投稿する」（ADR 0039）。渡したときだけ出す。
   * 文言はルームの種類で変わる（DM なら「DM にも投稿する」）ので、呼ぶ側が作る。
   */
  alsoInChannel?: { label: string; checked: boolean; onChange?: (checked: boolean) => void };
  /**
   * `@` の補完に出す候補（ADR 0043）。ルームのメンバーと `@channel` / `@here`。
   * 渡さなければ補完は開かない。入力中の文字で絞るのは入力欄の中でやる。
   */
  mentionCandidates?: readonly MentionCandidate[];
  /**
   * 書式のツールバーを出すか（ADR 0052 の追記）。覚えておくのは呼ぶ側（lib/composer-toolbar.ts）。
   * 見た目の部品は localStorage を読まない（story の見た目が、ブラウザに残った値で変わらないように）。
   */
  toolbarVisible?: boolean;
  onToggleToolbar?: (visible: boolean) => void;
  /** 補完を開いた状態で出す（story で状態を再現するため）。 */
  forceMentionQuery?: string;
  /** リンクの画面を開いた状態で出す（story で状態を再現するため）。 */
  forceLinkDialog?: { text: string; url: string };
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
  alsoInChannel,
  mentionCandidates,
  toolbarVisible = true,
  onToggleToolbar,
  forceMentionQuery,
  forceLinkDialog,
}: ComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  // 下書きにトークンが入っていたら名前のチップで描く（候補はルームのメンバーなので、その名前で足りる）
  const mentionNames = useMemo(
    () => Object.fromEntries((mentionCandidates ?? []).flatMap((c) => (c.kind === "user" ? [[c.id, c.name]] : []))),
    [mentionCandidates],
  );

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
      <div className="rounded-md border border-border bg-surface p-2 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary">
        <RichTextInput
          value={value}
          onChange={onChange}
          // IME の変換中の Enter と、補完を確定する Enter は入力欄が拾わない（ADR 0052 決定 6）
          onSubmit={(body) => {
            if (canSend) onSend?.(body);
          }}
          mentionCandidates={mentionCandidates}
          mentionNames={mentionNames}
          toolbar={toolbarVisible}
          label={target === "thread" ? "スレッドに返信" : "メッセージ"}
          placeholder={target === "thread" ? "スレッドに返信" : "メッセージを入力"}
          forceMentionQuery={forceMentionQuery}
          forceLinkDialog={forceLinkDialog}
          footer={
            <div className="flex items-center gap-1 pt-1">
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
              {/* Slack の書式設定アイコンと同じ、下線付きの「Aa」。隠しても記号の入力とショートカットは効く（ADR 0052 の追記） */}
              <IconButton
                label={toolbarVisible ? "書式のツールバーを隠す" : "書式のツールバーを出す"}
                aria-pressed={toolbarVisible}
                onClick={() => onToggleToolbar?.(!toolbarVisible)}
                className={cx("text-base font-semibold underline", toolbarVisible && "bg-surface-muted text-text")}
              >
                <span aria-hidden>Aa</span>
              </IconButton>
              {/* 送信はアイコンのボタン（Slack と同じ。オーナーの要望、2026-09-21）。押せるものなので primary */}
              <button
                type="button"
                aria-label="送信"
                title="送信（Enter）"
                onClick={() => onSend?.()}
                disabled={!canSend}
                className="ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary text-on-primary hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted"
              >
                <SendIcon className="size-4" />
              </button>
            </div>
          }
        />
      </div>
      <div className="flex items-center justify-between gap-3 pt-1.5">
        {alsoInChannel && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
            {/* 本物の checkbox を使い、キーボード操作と読み上げはブラウザに任せる。色だけ primary にそろえる */}
            <input
              type="checkbox"
              checked={alsoInChannel.checked}
              onChange={(e) => alsoInChannel.onChange?.(e.target.checked)}
              className="size-3.5 cursor-pointer accent-primary"
            />
            {alsoInChannel.label}
          </label>
        )}
        <p className="ml-auto text-2xs text-text-muted">Enter で送信 / Shift + Enter で改行</p>
      </div>
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
