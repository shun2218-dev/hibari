import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/button";
import { ChevronLeftIcon, CloseIcon, LockIcon } from "@/components/ui/icons";

import { MessageItem } from "./message-item";
import type { MessageView, RoomKind } from "./types";

type ThreadPanelProps = {
  room: { kind: RoomKind; name: string };
  /** 親のメッセージ。削除されていても tombstone のまま出す（スレッドは残る。ADR 0036）。 */
  root: MessageView;
  /** 返信。並びは受け取った順のまま（seq で並べるのはデータ層。CLAUDE.md ルール 3）。 */
  replies: MessageView[];
  /** 返信の数（削除された返信を除く）。区切りの見出しに出す。 */
  replyCount: number;
  /** 下の入力欄（`Composer` の target="thread"）。返信できない人（参加していない public）には JoinRoomBar などを渡す。 */
  footer: ReactNode;
  onClose?: () => void;
};

/**
 * スレッド（ADR 0036）。md 以上ではメンバーのパネルと同じ右のパネル、モバイルではルームの上に重なる全画面にする。
 * モバイルでシートにしないのは、返信を読みながら入力するには高さが足りないため。
 * 同じ要素をレイアウトだけ切り替えて使い、DOM に 2 回描かない。
 */
export function ThreadPanel({ room, root, replies, replyCount, footer, onClose }: ThreadPanelProps) {
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

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* 親は「N 件の返信」を出さない（パネルの中では区切りの見出しが同じことを言う） */}
        <MessageItem message={{ ...root, thread: undefined, grouped: false }} canReply={false} />
        {replyCount > 0 ? (
          <div className="flex items-center gap-3 px-4 pt-3 pb-1">
            <span className="text-2xs font-medium text-text-secondary">{replyCount} 件の返信</span>
            <span aria-hidden className="h-px flex-1 bg-border" />
          </div>
        ) : (
          <p className="px-4 pt-6 text-center text-xs text-text-muted">まだ返信はありません</p>
        )}
        <ol aria-label="返信" className="flex flex-col">
          {replies.map((reply) => (
            <li key={reply.key}>
              <MessageItem message={reply} canReply={false} />
            </li>
          ))}
        </ol>
      </div>

      {footer}
    </aside>
  );
}
