"use client";

import { useEffectEvent, useLayoutEffect, useRef } from "react";

import { TextButton } from "@/components/ui/button";

import { type MessageEditingView, MessageItem } from "./message-item";
import type { TimelineItem } from "./types";

/**
 * メッセージごとに出せる操作。編集は自分のメッセージだけ、削除は自分か admin 以上（ADR 0012）。
 * 判定はデータ層が行い、ここは結果だけを受け取る。
 */
export type MessageActions = { canEdit: boolean; canDelete: boolean };

type TimelineProps = {
  items: TimelineItem[];
  onRetry?: (key: string) => void;
  onDiscard?: (key: string) => void;
  onReply?: (key: string) => void;
  onDownload?: (attachmentId: string) => void;
  onMarkAllRead?: () => void;
  /** key ごとの操作の可否。渡さなければ「…」を出さない。 */
  actionsFor?: (key: string) => MessageActions;
  /** 「…」を開いているメッセージ。 */
  openMenuKey?: string;
  onToggleMenu?: (key: string) => void;
  onEdit?: (key: string) => void;
  onDelete?: (key: string) => void;
  /** 編集中のメッセージ（1 度に 1 件）。 */
  editingKey?: string;
  editing?: MessageEditingView;
  /** ホバーの見た目を固定で出すメッセージ（/dev/preview 用）。 */
  hoveredKey?: string;
  /**
   * いちばん上の近くまでスクロールした（古いメッセージを読み込むきっかけ）。
   * 内容が画面に収まってスクロールできないときも呼ぶ。もうないか、取得中かの判断は呼ぶ側が行う。
   */
  onReachStart?: () => void;
};

/** いちばん上からこの距離より近づいたら、古いメッセージを読み込む。1 ページを読み終える前に次を用意しておく。 */
const REACH_START_PX = 400;

/** いちばん下からこの距離の内側にいれば、最新を見ているとみなす。 */
const AT_BOTTOM_PX = 4;

/** 描き直す前のスクロール位置の手がかり。 */
type ScrollAnchor = { key: string; offsetTop: number; atBottom: boolean };

/**
 * メッセージの並び。並び順は受け取った順のまま（seq で並べるのはデータ層の責務。CLAUDE.md ルール 3）。
 */
export function Timeline({
  items,
  onRetry,
  onDiscard,
  onReply,
  onDownload,
  onMarkAllRead,
  actionsFor,
  openMenuKey,
  onToggleMenu,
  onEdit,
  onDelete,
  editingKey,
  editing,
  hoveredKey,
  onReachStart,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const anchorRef = useRef<ScrollAnchor | null>(null);
  // 呼び出し側が毎回新しい関数を渡しても、スクロール位置の合わせ直しは items が変わったときだけにする
  const reachStartAfterRender = useEffectEvent(() => onReachStart?.());

  function captureAnchor() {
    const el = scrollRef.current;
    const first = listRef.current?.firstElementChild;
    if (!el || !(first instanceof HTMLElement)) return;
    anchorRef.current = {
      key: first.dataset.key ?? "",
      offsetTop: first.offsetTop,
      atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX,
    };
  }

  // 描き直した後にスクロール位置を合わせる。
  // - 初めて描いたとき、または最新を見ていたときは、いちばん下を見せる
  // - 上に古いメッセージが足されたときは、それまで先頭だった要素が同じ位置に見えるようにずらす（読んでいた所が飛ばないように）
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = anchorRef.current;
    if (!anchor || anchor.atBottom) {
      el.scrollTop = el.scrollHeight;
    } else {
      const previousFirst = Array.from(listRef.current?.children ?? []).find(
        (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.key === anchor.key,
      );
      if (previousFirst) el.scrollTop += previousFirst.offsetTop - anchor.offsetTop;
    }
    captureAnchor();
    if (el.scrollHeight <= el.clientHeight) reachStartAfterRender();
  }, [items]);

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto pb-4"
      onScroll={(e) => {
        captureAnchor();
        if (e.currentTarget.scrollTop < REACH_START_PX) onReachStart?.();
      }}
    >
      <ol ref={listRef} aria-label="メッセージ" className="flex flex-col">
        {items.map((item) => {
          switch (item.type) {
            case "date":
              return (
                <li key={item.key} data-key={item.key} className="flex items-center gap-3 px-4 pt-6 pb-2">
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  <span className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-text">
                    {item.label}
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </li>
              );
            case "unread":
              return (
                <li key={item.key} data-key={item.key} className="flex items-center gap-2 pt-4 pb-1">
                  <span aria-hidden className="h-px w-4 bg-attention" />
                  <span className="text-2xs font-semibold text-attention-text">ここから未読</span>
                  <span aria-hidden className="h-px flex-1 bg-attention" />
                  <TextButton onClick={onMarkAllRead} className="text-2xs">
                    すべて既読にする
                  </TextButton>
                  <span aria-hidden className="h-px w-4 bg-attention" />
                </li>
              );
            case "message": {
              const { key } = item.message;
              const actions = actionsFor?.(key);
              return (
                <li key={key} data-key={key}>
                  <MessageItem
                    message={item.message}
                    forceHover={hoveredKey === key}
                    onRetry={() => onRetry?.(key)}
                    onDiscard={() => onDiscard?.(key)}
                    onReply={() => onReply?.(key)}
                    onDownload={onDownload}
                    canEdit={actions?.canEdit}
                    canDelete={actions?.canDelete}
                    menuOpen={openMenuKey === key}
                    onToggleMenu={() => onToggleMenu?.(key)}
                    onEdit={() => onEdit?.(key)}
                    onDelete={() => onDelete?.(key)}
                    editing={editingKey === key ? (editing ?? null) : null}
                  />
                </li>
              );
            }
          }
        })}
      </ol>
    </div>
  );
}
