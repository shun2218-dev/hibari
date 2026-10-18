"use client";

import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/button";
import { PaperclipIcon, PinIcon, PinOffIcon, ThreadIcon } from "@/components/ui/icons";

import { MessageBody } from "./message-body";
import type { PinnedMessageView, RoomKind } from "./types";

type PinsListProps = {
  roomKind: RoomKind;
  /** ピン留めした時刻の新しい順（並べるのはデータ層）。取得中は undefined。上限が 100 件なのでページングしない（ADR 0054 決定 5）。 */
  pins?: PinnedMessageView[];
  /** ピンを外す。外せない人（参加していない public ルーム）には渡さない（ADR 0054 決定 4）。 */
  onUnpin?: (key: string) => void;
  /** カードを押した（遷移は href に任せる）。呼ぶ側は「メッセージ」のタブに戻す（同じ URL でも戻れるように）。 */
  onOpen?: (key: string) => void;
  /** 外すボタンを固定で出す行（story で状態を再現するため）。 */
  hoveredKey?: string;
};

/**
 * ピン留めしたメッセージの一覧（ADR 0054）。ルームの「ピン」のタブで、タイムラインの代わりにメインの領域に出す（Slack と同じ）。
 * 1 件ずつ枠で囲んだカードにし、押すとそのメッセージへ飛ぶ（ADR 0042）。
 */
export function PinsList({ roomKind, pins, onUnpin, onOpen, hoveredKey }: PinsListProps) {
  if (pins === undefined) return <div className="min-h-0 flex-1" />;
  if (pins.length === 0) {
    const how = roomKind === "dm" ? "この会話にピン留めする" : "チャンネルへピン留めする";
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <PinIcon className="size-6 text-text-muted" />
        <p className="text-lg font-medium text-text">ピン留めしたメッセージはありません</p>
        <p className="max-w-88 text-sm leading-relaxed text-text-muted">
          メッセージの「…」から「{how}」を選ぶと、ここに表示されます
        </p>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
      <h2 className="pb-3 text-sm font-semibold text-text-secondary">ピン留めしたメッセージ</h2>
      <ul aria-label="ピン留めしたメッセージ" className="flex flex-col gap-2">
        {pins.map((pin) => (
          <li key={pin.key}>
            <PinnedCard
              pin={pin}
              onUnpin={onUnpin ? () => onUnpin(pin.key) : undefined}
              onOpen={() => onOpen?.(pin.key)}
              forceHover={hoveredKey === pin.key}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PinnedCard({
  pin,
  onUnpin,
  onOpen,
  forceHover,
}: {
  pin: PinnedMessageView;
  onUnpin?: () => void;
  onOpen: () => void;
  forceHover: boolean;
}) {
  return (
    <div className="group relative flex gap-3 rounded-md border border-border bg-surface px-4 py-3 hover:bg-surface-muted focus-within:bg-surface-muted">
      {/* カード全体を押せるように、リンクを上に広げる。ピンを外すボタンだけはその上に重ねて押せるようにする */}
      <Link
        href={pin.href}
        onClick={onOpen}
        aria-label={`${pin.sender.name} のメッセージへ移動`}
        className="absolute inset-0 rounded-md"
      />
      <Avatar id={pin.sender.id} name={pin.sender.name} imageUrl={pin.sender.avatarUrl} size="message" />
      <div className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-text">{pin.sender.name}</span>
          <time className="shrink-0 font-mono text-2xs text-text-muted">{pin.timeLabel}</time>
        </span>
        {pin.body !== "" && (
          // カード全体が 1 つのリンクなので、本文のリンクとチップは押せない見た目で描く（スレッドの一覧と同じ）
          <MessageBody
            body={pin.body}
            mentionNames={pin.mentionNames}
            interactive={false}
            className="line-clamp-4 text-lg leading-relaxed break-words text-text"
          />
        )}
        {(pin.attachmentCount > 0 || pin.inThread) && (
          <span className="flex items-center gap-3 pt-0.5 text-2xs text-text-muted">
            {pin.attachmentCount > 0 && (
              <span className="flex items-center gap-1">
                <PaperclipIcon className="size-3" />
                {pin.attachmentCount} 件の添付
              </span>
            )}
            {pin.inThread && (
              <span className="flex items-center gap-1">
                <ThreadIcon className="size-3" />
                スレッドの返信
              </span>
            )}
          </span>
        )}
      </div>
      {onUnpin && (
        <IconButton
          label="ピンを外す"
          title="ピンを外す"
          onClick={onUnpin}
          className={
            forceHover
              ? "relative size-7 self-start border border-border bg-surface"
              : "relative size-7 self-start border border-border bg-surface opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
          }
        >
          <PinOffIcon className="size-4" />
        </IconButton>
      )}
    </div>
  );
}
