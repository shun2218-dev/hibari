"use client";

import { type KeyboardEvent, useRef, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton, TextButton } from "@/components/ui/button";
import { CheckCircleIcon, CloseIcon, FileIcon, PaperclipIcon } from "@/components/ui/icons";
import { applyCompletion, candidateKey, filterCandidates, findMentionQuery, type MentionCandidate } from "@/lib/chat/mentions";
import { cx } from "@/lib/cx";

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
  /**
   * スレッドの入力欄の「チャンネルにも投稿する」（ADR 0039）。渡したときだけ出す。
   * 文言はルームの種類で変わる（DM なら「DM にも投稿する」）ので、呼ぶ側が作る。
   */
  alsoInChannel?: { label: string; checked: boolean; onChange?: (checked: boolean) => void };
  /**
   * `@` の補完に出す候補（ADR 0042）。ルームのメンバーと `@channel` / `@here`。
   * 渡さなければ補完は開かない。入力中の文字で絞るのはこの中でやる。
   */
  mentionCandidates?: readonly MentionCandidate[];
  /** 補完を開いた状態で出す（/dev/preview で状態を再現するため）。 */
  forceMentionQuery?: string;
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
  forceMentionQuery,
}: ComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // 補完の対象。null なら閉じている。start は `@` の位置、caret は確定のときに置き換える終わり
  const [query, setQuery] = useState<MentionQuery | null>(
    forceMentionQuery === undefined ? null : { start: 0, query: forceMentionQuery, caret: forceMentionQuery.length + 1 },
  );
  const [active, setActive] = useState(0);

  const matches = query && mentionCandidates ? filterCandidates(mentionCandidates, query.query) : [];
  const open = matches.length > 0;
  // 候補が減って選択が範囲の外に出ることがあるので、使うときに丸める
  const activeIndex = Math.min(active, matches.length - 1);

  /** 入力とキャレットの移動のたびに、直前が `@…` かどうかを見直す。 */
  function syncQuery(value: string, caret: number) {
    const found = mentionCandidates ? findMentionQuery(value, caret) : null;
    setQuery(found && { ...found, caret });
    // 打ち直したら候補の中身が変わるので、選択は先頭に戻す
    if (found?.query !== query?.query) setActive(0);
  }

  function choose(candidate: MentionCandidate) {
    if (!query) return;
    const next = applyCompletion(value, query.start, query.caret, candidate);
    onChange?.(next.value);
    setQuery(null);
    // 値は親が持つので、キャレットは描き直しのあとに置き直す
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // IME の変換中はどのキーも拾わない（変換を確定する Enter で送らないため）
    if (e.nativeEvent.isComposing) return;
    // 補完が開いている間は、Enter は確定に使う（送信しない）
    if (open) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActive((i) => (i + 1) % matches.length);
          return;
        case "ArrowUp":
          e.preventDefault();
          setActive((i) => (i - 1 + matches.length) % matches.length);
          return;
        case "Enter":
        case "Tab":
          e.preventDefault();
          choose(matches[activeIndex]);
          return;
        case "Escape":
          e.preventDefault();
          setQuery(null);
          return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
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
      {/* 補完は入力欄の上に重ねるので、位置の基準になる箱で包む */}
      <div className="relative">
        {open && <MentionList candidates={matches} active={activeIndex} onChoose={choose} />}
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
          ref={textarea}
          aria-label={target === "thread" ? "スレッドに返信" : "メッセージ"}
          rows={1}
          value={value}
          onChange={(e) => {
            onChange?.(e.target.value);
            syncQuery(e.target.value, e.target.selectionStart);
          }}
          // クリックや矢印でキャレットだけ動いたときも開閉を見直す
          onSelect={(e) => syncQuery(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setQuery(null)}
          onKeyDown={handleKeyDown}
          placeholder={target === "thread" ? "スレッドに返信" : "メッセージを入力"}
          className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1 text-lg leading-normal text-text focus-visible:outline-none"
        />
        <Button size="sm" onClick={onSend} disabled={!canSend}>
          送信
        </Button>
        </div>
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

/** 補完の対象。start は `@` の位置、query は `@` の後ろに打った文字、caret は確定のときに置き換える終わり。 */
type MentionQuery = { start: number; query: string; caret: number };

/**
 * `@` の補完（ADR 0042）。入力欄の上に重ねて出す。
 *
 * キャレットの位置には付けない。textarea では文字の座標を測れないので、入力欄の左上に固定で出す。
 * マウスで選ぶときに `onMouseDown` で確定するのは、textarea の blur で閉じてしまう前に拾うため。
 */
function MentionList({
  candidates,
  active,
  onChoose,
}: {
  candidates: MentionCandidate[];
  active: number;
  onChoose: (candidate: MentionCandidate) => void;
}) {
  return (
    <ul
      aria-label="メンションの候補"
      className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-72 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg"
    >
      {candidates.map((candidate, i) => (
        <li key={candidateKey(candidate)}>
          <button
            type="button"
            aria-current={i === active ? "true" : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              onChoose(candidate);
            }}
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
      ))}
    </ul>
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
