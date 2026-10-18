"use client";

import { useEffect, useRef } from "react";

import { cx } from "@/lib/cx";

/**
 * 期限に使う時刻の一覧（30 分刻み）。
 */
// 日付を開くボタンと時刻の入力。高さと枠をそろえて、並べたときに段差が出ないようにする。
export const pickerButtonClass =
  "flex h-11 cursor-pointer items-center rounded-md border border-border bg-surface px-3 text-lg text-text hover:bg-surface-muted focus-visible:-outline-offset-2";

/**
 * 時刻の候補の一覧（30 分ごと）。打った文字で絞った結果を受け取る。
 * 開いたときは、選んでいる時刻が見える位置まで送る（48 個あるので、いつも 00:00 から始まると毎回スクロールが要る）。
 */
export function TimeList({
  id,
  times,
  value,
  onSelect,
}: {
  id: string;
  times: string[];
  value?: string;
  onSelect: (time: string) => void;
}) {
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // jsdom には scrollIntoView が無いので、あるときだけ呼ぶ（無くても一覧は出る）
    selected.current?.scrollIntoView?.({ block: "center" });
  }, []);

  return (
    // 入力欄（combobox）に紐づく候補の一覧なので listbox / option にする
    <ul role="listbox" id={id} aria-label="時刻の候補" className="max-h-64 overflow-y-auto p-1.5">
      {times.map((time) => (
        <li key={time}>
          <button
            ref={time === value ? selected : undefined}
            type="button"
            role="option"
            aria-selected={time === value}
            onClick={() => onSelect(time)}
            className={cx(
              "flex h-9 w-full cursor-pointer items-center rounded-sm px-2.5 text-left text-base",
              time === value ? "bg-primary-subtle font-semibold text-primary" : "text-text hover:bg-surface-muted",
            )}
          >
            {time}
          </button>
        </li>
      ))}
    </ul>
  );
}
