"use client";

import { useLayoutEffect, useRef } from "react";

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
};

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
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 開いたときは最新（いちばん下）を見せる。以降の追従（下にいるときだけ追う）はデータ層と合わせて Phase 6-2 で扱う
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
      <ol aria-label="メッセージ" className="flex flex-col">
        {items.map((item) => {
          switch (item.type) {
            case "date":
              return (
                <li key={item.key} className="flex items-center gap-3 px-4 pt-6 pb-2">
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  <span className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-text">
                    {item.label}
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </li>
              );
            case "unread":
              return (
                <li key={item.key} className="flex items-center gap-2 pt-4 pb-1">
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
                <li key={key}>
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
