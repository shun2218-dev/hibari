"use client";

import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { TextButton } from "@/components/ui/button";
import { HashIcon, LockIcon, PaperclipIcon, ThreadIcon } from "@/components/ui/icons";
import { TextLink } from "@/components/ui/link";

import { MessageBody } from "./message-body";
import type { MessageLinkCardView } from "./types";

/**
 * 本文に貼られたパーマリンクのカード（ADR 0040）。
 *
 * 中身は「見る人の権限で取り直したもの」を props で受け取る。読めなければ unavailable のカードになり、
 * ルーム名も送信者も出さない（読めない・存在しない・削除済みを区別しない。ADR 0040）。
 *
 * 広げたかどうかは、このコンポーネントの中に持つ。画面の外に意味を持たない状態なので、データ層に上げない
 * （ADR 0018 の「パスワードの表示切り替え」と同じ扱い）。story とテストで広げた状態を描けるように、
 * 初期値だけ外から渡せる。
 */
export function MessageLinkCard({
  card,
  defaultExpanded = false,
}: {
  card: MessageLinkCardView;
  defaultExpanded?: boolean;
}) {
  if (card.state === "loading") {
    // 読み込めたときに高さが大きく変わってタイムラインがずれないよう、枠だけ先に置く。
    return <div aria-hidden className="h-14 rounded-md border border-border bg-surface-muted" />;
  }
  if (card.state === "unavailable") {
    return (
      <div className="rounded-md border border-border bg-surface px-3.5 py-2.5">
        <p className="text-sm text-text-muted italic">このメッセージは表示できません</p>
      </div>
    );
  }
  return <AvailableCard card={card} defaultExpanded={defaultExpanded} />;
}

function AvailableCard({
  card,
  defaultExpanded,
}: {
  card: Extract<MessageLinkCardView, { state: "ok" }>;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const roomLabel = `${card.workspaceName ? `${card.workspaceName} / ` : ""}${card.room.name}`;

  return (
    // 左の縦線は引用の印。押せる要素ではないので primary（緑）を使わない（docs/ui/tokens.md）
    <article aria-label={`${card.sender.name} のメッセージ`} className="rounded-md border border-l-2 border-border bg-surface px-3.5 py-2.5">
      <p className="flex items-center gap-1.5 text-2xs text-text-muted">
        {card.room.kind === "public" && <HashIcon className="size-3 shrink-0" />}
        {card.room.kind === "private" && <LockIcon className="size-3 shrink-0" />}
        {/* リンク先を開くのはこの行だけにする。カード全体を a にすると、下の「すべて表示する」を
            入れ子にすることになり、本文も選べなくなる。飛んだ先で位置まで合わせるのは Phase 6.11b。 */}
        <TextLink href={card.href} className="truncate font-normal text-text-muted">
          {roomLabel}
        </TextLink>
        {card.inThread && (
          <span className="flex shrink-0 items-center gap-1">
            <ThreadIcon className="size-3" />
            スレッドの返信
          </span>
        )}
      </p>

      <header className="mt-1 flex items-center gap-2">
        <Avatar id={card.sender.id} name={card.sender.name} imageUrl={card.sender.avatarUrl} size="xs" />
        <span className="text-sm font-semibold text-text">{card.sender.name}</span>
        <time className="font-mono text-2xs text-text-muted">{card.timeLabel}</time>
      </header>

      <MessageBody
        body={expanded || !card.clamped ? card.body : card.clampedBody}
        mentionNames={card.mentionNames}
        className="mt-0.5 text-base leading-relaxed break-words text-text"
      />

      {card.clamped && (
        <TextButton className="mt-1 text-xs font-semibold" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "折りたたむ" : "すべて表示する"}
        </TextButton>
      )}

      {card.attachmentCount > 0 && (
        <p className="mt-1 flex items-center gap-1 text-2xs text-text-muted">
          <PaperclipIcon className="size-3" />
          添付 {card.attachmentCount} 件
        </p>
      )}
    </article>
  );
}
