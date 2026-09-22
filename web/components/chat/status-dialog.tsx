"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

import { AnchoredPanel } from "@/components/ui/anchored-panel";
import { Button, TextButton } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { ChoiceChip } from "@/components/ui/choice";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { Portal } from "@/components/ui/portal";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { dateLabel, halfHourTimes, matchTimes, normalizeTime } from "@/lib/calendar";
import { cx } from "@/lib/cx";

import { EmojiPicker } from "./emoji-picker";
import type { UserStatusView } from "./types";

/**
 * ステータスを消す時刻の選び方（ADR 0049 決定 10）。文言も並びも Slack の「次の時間の経過後に削除」に合わせる。
 *
 * **相対の選択肢を絶対の時刻にするのはクライアント**（サーバーはユーザーのタイムゾーンを知らない）。
 * ここは選ばれた種類を持つだけで、時刻の計算はデータ層（構築順 4）が `Clock` で行う。
 * `custom` だけは、下に出る日付と時刻の入力から絶対の時刻を作る。
 */
export type StatusExpiry = "none" | "30m" | "1h" | "4h" | "today" | "week" | "custom";

export const statusExpiryLabel: Record<StatusExpiry, string> = {
  none: "削除しない",
  "30m": "30 分",
  "1h": "1 時間",
  "4h": "4 時間",
  today: "今日",
  week: "今週",
  custom: "日時を選択",
};

/** よく使うステータスの候補。Slack と同じく、押すと絵文字と文言がそのまま入る。 */
export const statusPresets: readonly UserStatusView[] = [
  { emoji: "📅", text: "会議中" },
  { emoji: "🚃", text: "移動中" },
  { emoji: "🍽️", text: "食事中" },
  { emoji: "🎧", text: "集中しています" },
  { emoji: "🌴", text: "休暇中" },
];

/** 文言の上限（ADR 0049 決定 5。Slack と同じ）。超える入力は受け付けない。 */
export const STATUS_TEXT_MAX = 100;

/** 文言だけを書いたときに添える絵文字。サーバーは絵文字を必須にしているので、クライアントが入れる。 */
export const DEFAULT_STATUS_EMOJI = "💬";

/**
 * 「日時を選択」で入れる値。日付は `YYYY-MM-DD`、時刻は `HH:MM`（30 分刻み）。
 * 絶対の時刻にするのはデータ層で、端末のタイムゾーンで解釈する。
 */
export type StatusExpiryCustom = { date: string; time: string };

type StatusDialogProps = {
  open: boolean;
  /** いま選んでいる絵文字。未選択なら既定の絵文字を出す。 */
  emoji?: string;
  text: string;
  expiry: StatusExpiry;
  /** `expiry` が custom のときに出す日付と時刻。 */
  custom?: StatusExpiryCustom;
  /** カレンダーが出している月（`YYYY-MM`）と今日（`YYYY-MM-DD`）。時刻は `Clock` を持つ側が決める。 */
  calendarMonth?: string;
  today?: string;
  /** いまの時刻（`HH:MM`）。今日を選んだときに、これより後の時刻だけを出す。 */
  minTime?: string;
  /** 開いている選択（カレンダー / 時刻の一覧）。 */
  openPicker?: "date" | "time";
  /** 絵文字のピッカーを開いている。 */
  pickerOpen?: boolean;
  /** すでに設定してある（「削除」を出すか）。 */
  canClear?: boolean;
  onClose?: () => void;
  onTogglePicker?: () => void;
  onPickEmoji?: (emoji: string) => void;
  onChangeText?: (text: string) => void;
  onChangeExpiry?: (expiry: StatusExpiry) => void;
  onChangeCustom?: (custom: StatusExpiryCustom) => void;
  onChangeCalendarMonth?: (month: string) => void;
  onToggleCustomPicker?: (picker: "date" | "time") => void;
  onSelectPreset?: (preset: UserStatusView) => void;
  onSave?: () => void;
  onClear?: () => void;
  /** emoji-mart はテーマを props で受け取る（ADR 0044 決定 7）。 */
  theme?: "light" | "dark";
};

/**
 * ラベルと中身の組。入力欄（`Field`）と同じラベルの見た目・同じ余白（gap-1.5）にそろえる。
 * 節ごとに余白を書いていたら、見出しと中身の距離がばらついた（オーナーの指摘、2026-09-21）。
 */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-text">{label}</p>
      {children}
    </div>
  );
}

// 日付を開くボタンと時刻の入力。高さと枠をそろえて、並べたときに段差が出ないようにする。
const pickerButtonClass =
  "flex h-11 cursor-pointer items-center rounded-md border border-border bg-surface px-3 text-lg text-text hover:bg-surface-muted focus-visible:-outline-offset-2";

/**
 * 時刻の候補の一覧（30 分ごと）。打った文字で絞った結果を受け取る。
 * 開いたときは、選んでいる時刻が見える位置まで送る（48 個あるので、いつも 00:00 から始まると毎回スクロールが要る）。
 */
function TimeList({
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

/**
 * カスタムステータスを設定するダイアログ（ADR 0049）。文言と選択肢は Slack に合わせる。
 *
 * 絵文字は 6.7 のピッカーをそのまま使う。開き方もリアクションと同じで、
 * md 以上は絵文字のボタンに合わせて**画面に浮かせ**、モバイルは下から出るシートにする（ADR 0044 決定 7）。
 * ダイアログの中に流し込むと、ピッカーのぶん（400px 近く）でダイアログが画面からはみ出す。
 */
export function StatusDialog({
  open,
  emoji = DEFAULT_STATUS_EMOJI,
  text,
  expiry,
  custom,
  calendarMonth,
  today,
  minTime,
  openPicker,
  pickerOpen = false,
  canClear = false,
  onClose,
  onTogglePicker,
  onPickEmoji,
  onChangeText,
  onChangeExpiry,
  onChangeCustom,
  onChangeCalendarMonth,
  onToggleCustomPicker,
  onSelectPreset,
  onSave,
  onClear,
  theme = "light",
}: StatusDialogProps) {
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const dateButtonRef = useRef<HTMLButtonElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);
  const timeListId = useId();
  const desktopPicker = useMediaQuery(DESKTOP_QUERY);
  const picker = <EmojiPicker onPick={(picked) => onPickEmoji?.(picked)} theme={theme} />;
  // 今日を選んだときは過ぎた時刻を出さず（設定した瞬間に消えるステータスを作らせない）、
  // 打った文字があればそれで絞る（Slack と同じ「一覧 + 自由入力」）
  const times = matchTimes(
    halfHourTimes().filter((t) => custom?.date !== today || minTime === undefined || t > minTime),
    custom?.time ?? "",
  );

  return (
    <Dialog
      open={open}
      title="ステータスを設定"
      description="いま何をしているかを、ワークスペースのメンバーに知らせます。"
      onClose={onClose}
      width="wide"
      actions={
        <>
          {canClear && (
            <TextButton tone="danger" className="mr-auto" onClick={onClear}>
              削除
            </TextButton>
          )}
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={onSave}>保存</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* 絵文字のボタンは入力欄と同じ行に入れる（leading）。ラベルと補足の外に置くと、補足のぶん下にずれる */}
        <TextField
          label="ステータス"
          value={text}
          maxLength={STATUS_TEXT_MAX}
          placeholder="いま何をしていますか？"
          onChange={(e) => onChangeText?.(e.target.value)}
          hint={`${[...text].length} / ${STATUS_TEXT_MAX}`}
          leading={
            <button
              ref={emojiButtonRef}
              type="button"
              aria-label="絵文字を選ぶ"
              aria-expanded={pickerOpen}
              onClick={onTogglePicker}
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-lg hover:bg-surface-muted"
            >
              <span role="img" aria-hidden>
                {emoji}
              </span>
            </button>
          }
        />

        {pickerOpen &&
          (desktopPicker ? (
            // 中身（emoji-mart）が自前の地と角丸を持つので、枠は外側で足すだけにする（リアクションと同じ）
            <AnchoredPanel
              anchorRef={emojiButtonRef}
              align="start"
              label="絵文字を選ぶ"
              onDismiss={onTogglePicker}
              className="w-88 overflow-hidden rounded-md border border-border bg-surface shadow-overlay"
            >
              {picker}
            </AnchoredPanel>
          ) : (
            <Portal>
              <div aria-hidden className="fixed inset-0 z-50 bg-overlay" onClick={onTogglePicker} />
              <div
                role="dialog"
                aria-label="絵文字を選ぶ"
                className="fixed inset-x-0 bottom-0 z-50 overflow-hidden rounded-t-lg bg-surface"
              >
                {picker}
              </div>
            </Portal>
          ))}

        <Section label="よく使うもの">
          {/* 行そのものに余白があるので、見出しとの距離は行の内側の余白ぶんだけ詰めて見える。左端は入力欄とそろえる */}
          <ul className="flex flex-col">
            {statusPresets.map((preset) => (
              <li key={preset.emoji}>
                <button
                  type="button"
                  onClick={() => onSelectPreset?.(preset)}
                  className="flex h-9.5 w-full cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-base text-text hover:bg-surface-muted"
                >
                  <span role="img" aria-hidden>
                    {preset.emoji}
                  </span>
                  {preset.text}
                </button>
              </li>
            ))}
          </ul>
        </Section>

        {/* 文言と選択肢は Slack に合わせる（オーナーの指摘、2026-09-21） */}
        <Section label="次の時間の経過後に削除">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(statusExpiryLabel) as StatusExpiry[]).map((value) => (
                <ChoiceChip
                  key={value}
                  name="status-expiry"
                  value={value}
                  checked={expiry === value}
                  onChange={(picked) => onChangeExpiry?.(picked as StatusExpiry)}
                >
                  {statusExpiryLabel[value]}
                </ChoiceChip>
              ))}
            </div>
            {expiry === "custom" && (
              // 日付も時刻も自前で出す（ブラウザ標準の入力はブラウザごとに見た目が変わるため。ADR 0049 の追記）。
              // 入れた日時を絶対の時刻にするのはデータ層で、端末のタイムゾーンで解釈する
              <div className="flex flex-wrap gap-2">
                <button
                  ref={dateButtonRef}
                  type="button"
                  aria-label="削除する日付"
                  aria-expanded={openPicker === "date"}
                  onClick={() => onToggleCustomPicker?.("date")}
                  className={pickerButtonClass}
                >
                  {custom?.date ? dateLabel(custom.date) : "日付を選ぶ"}
                </button>
                {/*
                  時刻は「候補の一覧 + 自由入力」にする（Slack のデスクトップと同じ）。
                  候補に無い時刻（17:05 など）も打って入れられる。モバイルは OS 標準の時刻入力に任せる
                */}
                {desktopPicker ? (
                  <input
                    ref={timeInputRef}
                    type="text"
                    inputMode="numeric"
                    role="combobox"
                    aria-label="削除する時刻"
                    aria-autocomplete="list"
                    aria-controls={timeListId}
                    aria-expanded={openPicker === "time"}
                    placeholder="17:00"
                    value={custom?.time ?? ""}
                    onChange={(e) => onChangeCustom?.({ date: custom?.date ?? "", time: e.target.value })}
                    onFocus={() => openPicker !== "time" && onToggleCustomPicker?.("time")}
                    className={cx(pickerButtonClass, "w-28")}
                  />
                ) : (
                  <input
                    type="time"
                    aria-label="削除する時刻"
                    value={normalizeTime(custom?.time ?? "") ?? ""}
                    onChange={(e) => onChangeCustom?.({ date: custom?.date ?? "", time: e.target.value })}
                    className={pickerButtonClass}
                  />
                )}
              </div>
            )}
          </div>
        </Section>

        {openPicker === "date" && (
          <AnchoredPanel
            anchorRef={dateButtonRef}
            align="start"
            label="日付を選ぶ"
            onDismiss={() => onToggleCustomPicker?.("date")}
            className="rounded-md border border-border bg-surface shadow-overlay"
          >
            <Calendar
              month={calendarMonth ?? custom?.date?.slice(0, 7) ?? today?.slice(0, 7) ?? ""}
              value={custom?.date}
              min={today}
              today={today}
              onChangeMonth={onChangeCalendarMonth}
              onSelect={(date) => onChangeCustom?.({ date, time: custom?.time ?? "" })}
            />
          </AnchoredPanel>
        )}

        {openPicker === "time" && desktopPicker && times.length > 0 && (
          <AnchoredPanel
            anchorRef={timeInputRef}
            align="start"
            label="時刻を選ぶ"
            onDismiss={() => onToggleCustomPicker?.("time")}
            className="w-32 rounded-md border border-border bg-surface shadow-overlay"
          >
            <TimeList
              id={timeListId}
              times={times}
              value={normalizeTime(custom?.time ?? "")}
              onSelect={(time) => onChangeCustom?.({ date: custom?.date ?? "", time })}
            />
          </AnchoredPanel>
        )}
      </div>
    </Dialog>
  );
}
