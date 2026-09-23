"use client";

import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { CloseIcon, DmIcon, FilterIcon, HashIcon, LockIcon, PaperclipIcon, ThreadIcon } from "@/components/ui/icons";
import { dateLabel, type SearchFilters } from "@/lib/chat/search/search-query";
import { cx } from "@/lib/cx";

import { MessageBody } from "./message-body";
import type { SearchResultView } from "./types";

/** 外せる絞り込み。日付は `after` と `before` をまとめて外すので、ひとまとめの名前にする。 */
export type SearchFilterKey = "sender" | "room" | "date";

/**
 * 検索結果の画面（ADR 0061）。Slack と同じく、サイドバーを畳んでメインの領域を全幅で使う。
 *
 * 出さないもの:
 *   - 件数（「〜件の結果」）。O(1) では出せないため（ADR 0061 決定 4。オーナーの確認: 2026-09-23）
 *   - 並べ替え。新しい順だけなので選ばせるものがない（同上）
 *   - 種類のタブ（メッセージ / ファイル / チャンネル）。検索するのはメッセージだけ（決定 5）
 *
 * 絞り込みのチップは、押すとフィルターのダイアログが開く。Slack はチップごとに小さなドロップダウンを出すが、
 * 6.16 では 3 つ（送信者・場所・日付）しかないのでダイアログ 1 つにまとめた。
 * チップも入力欄の修飾子も、同じ `SearchFilters` を編集する（決定 5）。
 */
export function SearchResults({
  query,
  filters,
  results,
  onOpenFilters,
  onClearFilter,
  onReachEnd,
  highlightTerms,
  today,
}: {
  /** 検索した語（修飾子を除いた本文の条件）。 */
  query: string;
  filters: SearchFilters;
  /** 新しい順に並べた結果。取得中は undefined。 */
  results?: SearchResultView[];
  onOpenFilters?: () => void;
  onClearFilter?: (key: SearchFilterKey) => void;
  /** いちばん下の近くまでスクロールした（続きを読み込むきっかけ）。 */
  onReachEnd?: () => void;
  /** 本文の中で塗る語。空なら塗らない。 */
  highlightTerms: readonly string[];
  /** 端末の今日（`YYYY-MM-DD`）。日付のチップの文言（「過去 7 日間」）を出すのに使う。 */
  today: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="shrink-0 px-4 pt-4 md:px-6">
        <h1 className="text-xl font-semibold text-text">
          <span className="text-text-secondary">検索結果：</span>
          {query}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilterChip
            label="送信者"
            value={filters.sender?.name}
            onOpen={onOpenFilters}
            onClear={() => onClearFilter?.("sender")}
          />
          <FilterChip
            label="場所"
            value={filters.room?.name}
            onOpen={onOpenFilters}
            onClear={() => onClearFilter?.("room")}
          />
          <FilterChip
            label="日付"
            value={dateLabel(filters, today)}
            onOpen={onOpenFilters}
            onClear={() => onClearFilter?.("date")}
          />
          <button
            type="button"
            onClick={onOpenFilters}
            className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-sm text-primary hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          >
            <FilterIcon className="size-4" />
            フィルター
          </button>
        </div>
      </div>

      <div
        className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-6 md:px-6"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) onReachEnd?.();
        }}
      >
        {results === undefined ? null : results.length === 0 ? (
          <Empty query={query} />
        ) : (
          <ul aria-label="検索結果" className="flex flex-col gap-2">
            {results.map((item) => (
              <li key={item.key}>
                <ResultItem item={item} highlightTerms={highlightTerms} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Empty({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 pt-16 text-center">
      <p className="text-base font-medium text-text">「{query}」に一致するメッセージはありません</p>
      <p className="text-xs leading-relaxed text-text-muted">
        別の言葉を試すか、送信者・場所・日付の絞り込みを外してください
      </p>
    </div>
  );
}

function FilterChip({
  label,
  value,
  onOpen,
  onClear,
}: {
  label: string;
  value?: string;
  onOpen?: () => void;
  onClear?: () => void;
}) {
  const set = value !== undefined;
  return (
    <span className={cx("flex h-8 items-center rounded-full border", set ? "border-primary bg-primary-subtle" : "border-border")}>
      <button
        type="button"
        onClick={onOpen}
        className={cx(
          "flex h-8 items-center rounded-full px-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
          set ? "pr-1 text-primary" : "text-text-secondary hover:bg-surface-muted",
        )}
      >
        {set ? `${label}：${value}` : label}
      </button>
      {set && (
        <button
          type="button"
          aria-label={`${label}の絞り込みを外す`}
          onClick={onClear}
          className="mr-1 flex size-6 items-center justify-center rounded-full text-primary hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        >
          <CloseIcon className="size-3.5" />
        </button>
      )}
    </span>
  );
}

function ResultItem({ item, highlightTerms }: { item: SearchResultView; highlightTerms: readonly string[] }) {
  const RoomIcon = item.room.kind === "dm" ? DmIcon : item.room.kind === "private" ? LockIcon : HashIcon;
  return (
    <Link
      href={item.href}
      className="flex gap-3 rounded-md border border-border bg-surface p-3 hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
    >
      <Avatar id={item.sender.id} name={item.sender.name} imageUrl={item.sender.avatarUrl} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-base font-semibold text-text">{item.sender.name}</span>
          <span className="flex min-w-0 items-center gap-0.5 text-xs text-text-muted">
            <RoomIcon className="size-3.5 shrink-0" />
            <span className="truncate">{item.room.name}</span>
          </span>
          <span className="ml-auto shrink-0 text-xs text-text-muted">{item.timeLabel}</span>
        </div>
        {/* 行全体がリンクなので、本文の中のリンクとチップは押せない見た目にする（「後で」の一覧と同じ） */}
        <MessageBody
          body={item.body}
          mentionNames={item.mentionNames}
          interactive={false}
          highlight={highlightTerms}
          className="mt-0.5 text-lg leading-relaxed text-text"
        />
        {(item.inThread || item.attachmentCount > 0) && (
          <div className="mt-1 flex items-center gap-3 text-xs text-text-muted">
            {item.inThread && (
              <span className="flex items-center gap-1">
                <ThreadIcon className="size-3.5" />
                スレッドの返信
              </span>
            )}
            {item.attachmentCount > 0 && (
              <span className="flex items-center gap-1">
                <PaperclipIcon className="size-3.5" />
                添付 {item.attachmentCount} 件
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
