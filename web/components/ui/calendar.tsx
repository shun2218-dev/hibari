"use client";

import { useRef } from "react";

import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { dateLabel, monthGrid, monthLabel, shiftDate, shiftMonth, weekdayLabels } from "@/lib/calendar";
import { cx } from "@/lib/cx";

type CalendarProps = {
  /** 表示している月（`YYYY-MM`）。 */
  month: string;
  /** 選んでいる日（`YYYY-MM-DD`）。 */
  value?: string;
  /** これより前の日は選べない（`YYYY-MM-DD`）。ステータスの期限は未来だけなので今日を渡す。 */
  min?: string;
  /** 今日（`YYYY-MM-DD`）。丸で示す。時刻は `Clock` を持つ側が決めるので、ここでは受け取るだけ。 */
  today?: string;
  onChangeMonth?: (month: string) => void;
  onSelect?: (date: string) => void;
};

/**
 * 日付を選ぶカレンダー（ADR 0049 の追記）。ブラウザ標準の日付入力をやめ、Slack と同じ見た目にするために作った。
 *
 * **状態は持たない。** 表示している月も選んでいる日も props で受け取る（ほかの presentational な部品と同じ）。
 * 置き場所も決めない（`AnchoredPanel` などで浮かせるのは呼ぶ側）。ピン留めの期限（6.12）や検索の期間（6.16）でも使えるように。
 *
 * キーボードは矢印で日を移り、Enter / Space で決める。マス目のうちフォーカスを受けるのは 1 つだけにして
 * （roving tabindex）、Tab を 1 回押すたびに 42 個を通らなくてよいようにする。
 */
export function Calendar({ month, value, min, today, onChangeMonth, onSelect }: CalendarProps) {
  const grid = useRef<HTMLDivElement>(null);
  const weeks = monthGrid(month);
  // フォーカスを受ける 1 つ。選んでいる日 → 今日 → 月の 1 日 の順に決める
  const focusable = weeks.flat().find((d) => d === value) ?? weeks.flat().find((d) => d === today) ?? weeks.flat().find(Boolean);

  function move(from: string, days: number) {
    const to = shiftDate(from, days);
    // 月をまたいだら、その月を出してから当てる（描き直しの後なので、フォーカスは effect ではなくここで探す）
    if (to.slice(0, 7) !== month) onChangeMonth?.(to.slice(0, 7));
    requestAnimationFrame(() => {
      grid.current?.querySelector<HTMLButtonElement>(`[data-date="${to}"]`)?.focus();
    });
  }

  return (
    <div className="flex w-70 flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="前の月"
          onClick={() => onChangeMonth?.(shiftMonth(month, -1))}
          className="flex size-8 cursor-pointer items-center justify-center rounded-sm text-text-secondary hover:bg-surface-muted"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <p aria-live="polite" className="text-base font-semibold text-text">
          {monthLabel(month)}
        </p>
        <button
          type="button"
          aria-label="次の月"
          onClick={() => onChangeMonth?.(shiftMonth(month, 1))}
          className="flex size-8 cursor-pointer items-center justify-center rounded-sm text-text-secondary hover:bg-surface-muted"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </div>

      <div role="grid" aria-label={monthLabel(month)} ref={grid} className="flex flex-col gap-1">
        <div role="row" className="grid grid-cols-7">
          {weekdayLabels.map((w) => (
            <span key={w} role="columnheader" className="py-1 text-center text-2xs text-text-muted">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, i) => (
          <div role="row" key={i} className="grid grid-cols-7 gap-1">
            {week.map((date, j) => {
              if (!date) return <span role="gridcell" key={j} />;
              const disabled = min !== undefined && date < min;
              const selected = date === value;
              return (
                <button
                  role="gridcell"
                  key={date}
                  type="button"
                  data-date={date}
                  disabled={disabled}
                  aria-selected={selected}
                  aria-label={dateLabel(date)}
                  tabIndex={date === focusable ? 0 : -1}
                  onClick={() => onSelect?.(date)}
                  onKeyDown={(e) => {
                    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
                    if (step === undefined) return;
                    e.preventDefault();
                    move(date, step);
                  }}
                  className={cx(
                    "flex h-9 items-center justify-center rounded-sm text-base",
                    disabled
                      ? "cursor-not-allowed text-text-muted"
                      : selected
                        ? "cursor-pointer bg-primary font-semibold text-on-primary"
                        : "cursor-pointer text-text hover:bg-surface-muted",
                    // 今日は選んでいなくても分かるようにする（Slack と同じ）
                    !selected && date === today && "font-semibold text-primary",
                  )}
                >
                  {Number(date.slice(8))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
