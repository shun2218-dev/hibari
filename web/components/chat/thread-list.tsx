import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { UnreadBadge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { ChevronLeftIcon, LockIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import { MessageBody } from "./message-body";
import type { ThreadListItemView } from "./types";

type ThreadListProps = {
  /** 最後の返信が新しい順（並べるのはデータ層。ADR 0036）。 */
  threads: ThreadListItemView[];
  /** 押したときの行き先（そのルームを、スレッドのパネルを開いた状態で出す）。 */
  threadHref: (key: string) => string;
  /** モバイルで一覧に戻る。md 以上では出さない。 */
  onBack?: () => void;
};

/**
 * 参加しているスレッドの一覧（ADR 0036）。サイドバーの「スレッド」から開き、ルームの代わりにメインの領域に出す。
 * スレッドの中身はここでは展開せず、1 行ずつ親の冒頭と返信の数だけを出して、押すとルームのスレッドのパネルに移る。
 * 返信を読む場所と書く場所をパネルの 1 つにそろえ、同じ返信が 2 か所で既読になる経路を作らないため。
 */
export function ThreadList({ threads, threadHref, onBack }: ThreadListProps) {
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 md:pr-3 md:pl-4">
        <IconButton label="チャンネル一覧に戻る" onClick={onBack} className="md:hidden">
          <ChevronLeftIcon className="size-5" />
        </IconButton>
        <div className="min-w-0 flex-1 pl-1 md:pl-0">
          <h1 className="text-lg font-bold text-text">スレッド</h1>
          <p className="text-2xs text-text-muted">参加しているスレッド</p>
        </div>
      </header>

      {threads.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-lg font-medium text-text">参加しているスレッドはありません</p>
          <p className="max-w-88 text-sm leading-relaxed text-text-muted">
            メッセージに返信するか、自分のメッセージに返信がつくと、ここに表示されます
          </p>
        </div>
      ) : (
        <ul aria-label="参加しているスレッド" className="min-h-0 flex-1 overflow-y-auto">
          {threads.map((thread) => (
            <li key={thread.key} className="border-b border-border">
              <ThreadRow thread={thread} href={threadHref(thread.key)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ThreadRow({ thread, href }: { thread: ThreadListItemView; href: string }) {
  const { room, root } = thread;
  const unread = thread.unreadCount > 0;
  return (
    <Link href={href} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-surface-muted md:px-6">
      <span className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1 text-2xs font-medium text-text-secondary">
          {room.kind === "public" && <span aria-label="公開チャンネル">#</span>}
          {room.kind === "private" && (
            <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3" />
          )}
          <span className="truncate">{room.name}</span>
        </span>
        <UnreadBadge count={thread.unreadCount} />
      </span>
      {/* 本文はブロック（段落・リスト・コード）を含むので、ここから下は span ではなく div で囲む（ADR 0051） */}
      <div className="flex gap-2.5">
        <Avatar id={root.sender.id} name={root.sender.name} imageUrl={root.sender.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-text">{root.sender.name}</span>
            <time className="shrink-0 font-mono text-2xs text-text-muted">{root.timeLabel}</time>
          </span>
          {root.deleted ? (
            <span className="block text-base text-text-muted italic">このメッセージは削除されました</span>
          ) : (
            // 行全体が 1 つのリンクなので、本文のリンクとチップは押せない見た目で描く
            <MessageBody
              body={root.body}
              mentionNames={root.mentionNames}
              interactive={false}
              className="line-clamp-2 text-base leading-relaxed break-words text-text"
            />
          )}
        </div>
      </div>
      <span className="flex items-center gap-2 pl-10.5 text-xs">
        <span className={cx("font-semibold", unread ? "text-text" : "text-text-secondary")}>
          {thread.replyCount} 件の返信
        </span>
        <span className="font-mono text-2xs text-text-muted">最終返信 {thread.lastReplyLabel}</span>
      </span>
    </Link>
  );
}
