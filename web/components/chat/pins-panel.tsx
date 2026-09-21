"use client";

import Link from "next/link";
import { useRef } from "react";

import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/button";
import { ChevronLeftIcon, CloseIcon, LockIcon, PaperclipIcon, PinIcon, PinOffIcon, ThreadIcon } from "@/components/ui/icons";
import { ResizeHandle } from "@/components/ui/resize-handle";

import { MessageBody } from "./message-body";
import type { PinnedMessageView, RoomKind } from "./types";

type PinsPanelProps = {
  room: { kind: RoomKind; name: string };
  /** ピン留めした時刻の新しい順（並べるのはデータ層）。取得中は undefined。上限が 100 件なのでページングしない（ADR 0054 決定 5）。 */
  pins?: PinnedMessageView[];
  /** ピンを外す。外せない人（参加していない public ルーム）には渡さない（ADR 0054 決定 4）。 */
  onUnpin?: (key: string) => void;
  onClose?: () => void;
};

/**
 * ピン留めしたメッセージの一覧（ADR 0054）。ヘッダーの「ピン留め」から開く。
 * md 以上はスレッドと同じ右のパネル、モバイルは全画面（スレッドのパネルと同じ置き方）。
 * 行を押すと、そのメッセージへ飛ぶ（ADR 0042）。ここでは本文を畳んで、全文はタイムラインで読む。
 */
export function PinsPanel({ room, pins, onUnpin, onClose }: PinsPanelProps) {
  const panel = useRef<HTMLElement>(null);
  const dm = room.kind === "dm";

  return (
    <aside
      ref={panel}
      aria-label="ピン留め"
      className="fixed inset-0 z-40 flex flex-col bg-surface md:relative md:z-auto md:pane-thread md:shrink-0 md:border-l md:border-border"
    >
      <ResizeHandle pane="thread" grow="left" measure={panel} />
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 md:pr-2 md:pl-4">
        <IconButton label={dm ? "会話に戻る" : "チャンネルに戻る"} onClick={onClose} className="md:hidden">
          <ChevronLeftIcon className="size-5" />
        </IconButton>
        <div className="min-w-0 flex-1 pl-1 md:pl-0">
          <h2 className="text-sm font-bold text-text">ピン留め</h2>
          <p className="flex items-center gap-1 truncate text-2xs text-text-muted">
            {room.kind === "public" && <span aria-label="公開チャンネル">#</span>}
            {room.kind === "private" && (
              <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3" />
            )}
            <span className="truncate">{room.name}</span>
          </p>
        </div>
        <IconButton label="ピン留めを閉じる" onClick={onClose} className="max-md:hidden">
          <CloseIcon className="size-4" />
        </IconButton>
      </header>

      {pins === undefined ? (
        <div className="min-h-0 flex-1" />
      ) : pins.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <PinIcon className="size-6 text-text-muted" />
          <p className="text-lg font-medium text-text">ピン留めしたメッセージはありません</p>
          <p className="max-w-72 text-sm leading-relaxed text-text-muted">
            メッセージの「…」から「{dm ? "この会話にピン留めする" : "チャンネルへピン留めする"}」を選ぶと、ここに表示されます
          </p>
        </div>
      ) : (
        <ul aria-label="ピン留めしたメッセージ" className="min-h-0 flex-1 overflow-y-auto">
          {pins.map((pin) => (
            <li key={pin.key} className="border-b border-border">
              <PinnedRow pin={pin} onUnpin={onUnpin ? () => onUnpin(pin.key) : undefined} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function PinnedRow({ pin, onUnpin }: { pin: PinnedMessageView; onUnpin?: () => void }) {
  return (
    <div className="group relative flex gap-2.5 px-4 py-3 hover:bg-surface-muted focus-within:bg-surface-muted">
      {/* 行全体を押せるように、リンクを行の上に広げる。ピンを外すボタンだけはその上に重ねて押せるようにする */}
      <Link href={pin.href} aria-label={`${pin.sender.name} のメッセージへ移動`} className="absolute inset-0" />
      <Avatar id={pin.sender.id} name={pin.sender.name} imageUrl={pin.sender.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-text">{pin.sender.name}</span>
          <time className="shrink-0 font-mono text-2xs text-text-muted">{pin.timeLabel}</time>
        </span>
        {pin.body !== "" && (
          // 行全体が 1 つのリンクなので、本文のリンクとチップは押せない見た目で描く（スレッドの一覧と同じ）
          <MessageBody
            body={pin.body}
            mentionNames={pin.mentionNames}
            interactive={false}
            className="line-clamp-3 text-base leading-relaxed break-words text-text"
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
        <p className="flex items-center gap-1 pt-1 text-2xs font-medium text-text-secondary">
          <PinIcon className="size-3" />
          {pin.pinnedBy} がピン留め
        </p>
      </div>
      {onUnpin && (
        <IconButton
          label="ピンを外す"
          title="ピンを外す"
          onClick={onUnpin}
          className="relative size-7 self-start border border-border bg-surface opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
        >
          <PinOffIcon className="size-4" />
        </IconButton>
      )}
    </div>
  );
}
