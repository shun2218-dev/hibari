"use client";

import { type KeyboardEvent, useRef } from "react";

import { cx } from "@/lib/cx";

export type TabItem<T extends string> = {
  value: T;
  label: string;
  /** ラベルの後ろに添える件数。渡さなければ出さない（Slack の「後で」は「進行中」にだけ付く）。 */
  count?: number;
};

/**
 * タブの並び（WAI-ARIA の tablist）。選んでいるタブは下線と太字で示す。押せるので下線は緑（docs/ui/tokens.md）。
 *
 * 左右の矢印キーで隣のタブへ移り、そのまま選ぶ（手動で選ばせる方式ではなく、フォーカスと選択を一緒に動かす）。
 * タブの中身（tabpanel）は呼ぶ側が描き、`panelId` で結びつける。
 */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  panelId,
}: {
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange?: (value: T) => void;
  panelId?: string;
}) {
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = items.findIndex((item) => item.value === value);
    const next = items[(index + (event.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    onChange?.(next.value);
    list.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div ref={list} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-6 border-b border-border">
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            data-value={item.value}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange?.(item.value)}
            className={cx(
              "relative -mb-px flex h-10 cursor-pointer items-center gap-1.5 text-base",
              selected ? "font-semibold text-text" : "text-text-secondary hover:text-text",
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="font-mono text-sm font-normal">{item.count}</span>}
            {selected && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}
          </button>
        );
      })}
    </div>
  );
}
