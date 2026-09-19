import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/button";
import { ChevronLeftIcon, CloseIcon, LockIcon } from "@/components/ui/icons";

import type { RoomKind } from "./types";

type ThreadPanelProps = {
  room: { kind: RoomKind; name: string };
  /**
   * 親と返信の並び。`Timeline` に、親・「N 件の返信」の区切り（thread-divider）・返信を並べて渡す（toThreadTimelineItems）。
   * 取得中は何も渡さない。
   */
  children?: ReactNode;
  /** 下の入力欄（`Composer` の target="thread"）。返信できない人（参加していない public）には JoinRoomBar などを渡す。 */
  footer?: ReactNode;
  onClose?: () => void;
};

/**
 * スレッド（ADR 0036）。md 以上ではメンバーのパネルと同じ右のパネル、モバイルではルームの上に重なる全画面にする。
 * モバイルでシートにしないのは、返信を読みながら入力するには高さが足りないため。
 * 同じ要素をレイアウトだけ切り替えて使い、DOM に 2 回描かない。
 */
export function ThreadPanel({ room, children, footer, onClose }: ThreadPanelProps) {
  return (
    <aside
      aria-label="スレッド"
      className="fixed inset-0 z-40 flex flex-col bg-surface md:static md:z-auto md:w-96 md:shrink-0 md:border-l md:border-border"
    >
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 md:pr-2 md:pl-4">
        <IconButton label="チャンネルに戻る" onClick={onClose} className="md:hidden">
          <ChevronLeftIcon className="size-5" />
        </IconButton>
        <div className="min-w-0 flex-1 pl-1 md:pl-0">
          <h2 className="text-sm font-bold text-text">スレッド</h2>
          <p className="flex items-center gap-1 truncate text-2xs text-text-muted">
            {room.kind === "public" && <span aria-label="公開チャンネル">#</span>}
            {room.kind === "private" && (
              <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3" />
            )}
            <span className="truncate">{room.name}</span>
          </p>
        </div>
        <IconButton label="スレッドを閉じる" onClick={onClose} className="max-md:hidden">
          <CloseIcon className="size-4" />
        </IconButton>
      </header>
      {children ?? <div className="min-h-0 flex-1" />}
      {footer}
    </aside>
  );
}
