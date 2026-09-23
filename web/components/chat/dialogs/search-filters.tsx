"use client";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { CheckIcon, HashIcon, LockIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import type { SearchFilters, UserRef } from "@/components/chat/types";

/** 日付の選択肢（ADR 0061 決定 5 の `before:` / `after:` / `on:` を、よく使う形にまとめたもの）。 */
export const DATE_CHOICES = [
  { value: "any", label: "いつでも" },
  { value: "today", label: "今日" },
  { value: "7d", label: "過去 7 日間" },
  { value: "30d", label: "過去 30 日間" },
] as const;

export type DateChoice = (typeof DATE_CHOICES)[number]["value"];

export type RoomOption = { id: string; kind: "public" | "private" | "dm"; name: string };

/**
 * 検索の絞り込み（ADR 0061 決定 5。Slack の「検索フィルター」と同じ置き場所）。
 *
 * 編集するのは入力欄の修飾子と同じ `SearchFilters` で、ここを触ると入力欄の `in:` `from:` も書き換わる。
 * Slack の項目のうち、6.16 で作るのは送信者・場所・日付の 3 つだけ（ファイルの種類・絵文字・メッセージの状態はスコープ外）。
 *
 * 中身だけをスクロールさせ、見出しと下のボタンは残す（ADR 0059 のルームの設定と同じ）。
 */
export function SearchFiltersDialog({
  open,
  filters,
  senderQuery,
  senderOptions,
  roomQuery,
  roomOptions,
  date,
  onChangeSenderQuery,
  onSelectSender,
  onChangeRoomQuery,
  onSelectRoom,
  onChangeDate,
  onClear,
  onClose,
  onSubmit,
}: {
  open: boolean;
  filters: SearchFilters;
  /** 送信者の入力欄に打った文字。選んだあとは空にして、選んだ人をその下に出す。 */
  senderQuery: string;
  /** 打った文字に一致する人（並べるのはデータ層）。 */
  senderOptions: UserRef[];
  roomQuery: string;
  roomOptions: RoomOption[];
  date: DateChoice;
  onChangeSenderQuery?: (value: string) => void;
  onSelectSender?: (user: UserRef) => void;
  onChangeRoomQuery?: (value: string) => void;
  onSelectRoom?: (room: RoomOption) => void;
  onChangeDate?: (value: DateChoice) => void;
  onClear?: () => void;
  onClose?: () => void;
  onSubmit?: () => void;
}) {
  // 選んである値が候補の中にあれば、その行が印になる。候補に出ていないとき（打った文字を消した・別の語で探している）だけ、
  // 何で絞り込んでいるかを文で残す。両方出すと同じことを 2 回言うことになる
  const senderShown = senderOptions.some((u) => u.id === filters.sender?.id);
  const roomShown = roomOptions.some((r) => r.id === filters.room?.id);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="検索フィルター"
      actions={
        <>
          <Button variant="secondary" onClick={onClear}>
            フィルターをクリアする
          </Button>
          <Button onClick={onSubmit}>検索する</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <TextField
            label="送信者"
            placeholder="例：山田 太郎"
            value={senderQuery}
            onChange={(e) => onChangeSenderQuery?.(e.target.value)}
          />
          {filters.sender && !senderShown && <Selected label={filters.sender.name} />}
          {senderOptions.length > 0 && (
            <ul className="flex flex-col">
              {senderOptions.map((user) => (
                <li key={user.id}>
                  <OptionRow selected={filters.sender?.id === user.id} onClick={() => onSelectSender?.(user)}>
                    <Avatar id={user.id} name={user.name} imageUrl={user.avatarUrl} size="sm" />
                    <span className="truncate">{user.name}</span>
                  </OptionRow>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <TextField
            label="場所"
            placeholder="例：#general"
            value={roomQuery}
            onChange={(e) => onChangeRoomQuery?.(e.target.value)}
          />
          {filters.room && !roomShown && <Selected label={filters.room.name} />}
          {roomOptions.length > 0 && (
            <ul className="flex flex-col">
              {roomOptions.map((room) => {
                const Icon = room.kind === "private" ? LockIcon : HashIcon;
                return (
                  <li key={room.id}>
                    <OptionRow selected={filters.room?.id === room.id} onClick={() => onSelectRoom?.(room)}>
                      {room.kind === "dm" ? (
                        <span className="size-5 shrink-0" aria-hidden />
                      ) : (
                        <Icon className="size-4 shrink-0 text-text-secondary" />
                      )}
                      <span className="truncate">{room.name}</span>
                    </OptionRow>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-text">日付</legend>
          <div className="flex flex-wrap gap-2">
            {DATE_CHOICES.map((choice) => (
              <ChoiceChip
                key={choice.value}
                name="search-date"
                value={choice.value}
                checked={date === choice.value}
                onChange={(value) => onChangeDate?.(value as DateChoice)}
              >
                {choice.label}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

/** 選んである値。押して外すのは結果の画面のチップ側で行うので、ここでは印だけ出す。 */
function Selected({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-primary">
      <CheckIcon className="size-4 shrink-0" />
      {label} で絞り込みます
    </p>
  );
}

function OptionRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
        selected ? "bg-primary-subtle text-primary" : "text-text hover:bg-surface-muted",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
      )}
    >
      {children}
    </button>
  );
}
