import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { UnreadBadge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { BellIcon, BellOffIcon, ChevronLeftIcon, LockIcon, MoreIcon } from "@/components/ui/icons";
import { MenuItem } from "@/components/ui/menu-item";
import { Popover } from "@/components/ui/popover";
import { cx } from "@/lib/cx";

import { MessageBody } from "./message-body";
import type { ThreadListItemView } from "./types";

type ThreadListProps = {
  /** 最後の返信が新しい順（並べるのはデータ層。ADR 0036）。 */
  threads: ThreadListItemView[];
  /** 押したときの行き先（そのルームを、スレッドのパネルを開いた状態で出す）。 */
  threadHref: (key: string) => string;
  /** 行の「その他」から、返信の通知を切り替える（ADR 0056）。渡さなければ「その他」を出さない。 */
  onToggleNotify?: (key: string) => void;
  /** 「その他」を開いている行。 */
  openMenuKey?: string;
  onToggleMenu?: (key: string) => void;
  /** ポインタを乗せている行（story で見せるため）。 */
  hoveredKey?: string;
  /** モバイルで一覧に戻る。md 以上では出さない。 */
  onBack?: () => void;
};

/**
 * 参加しているスレッドの一覧（ADR 0036）。サイドバーの「スレッド」から開き、ルームの代わりにメインの領域に出す。
 * スレッドの中身はここでは展開せず、1 行ずつ親の冒頭と返信の数だけを出して、押すとルームのスレッドのパネルに移る。
 * 返信を読む場所と書く場所をパネルの 1 つにそろえ、同じ返信が 2 か所で既読になる経路を作らないため。
 */
export function ThreadList({ threads, threadHref, onToggleNotify, openMenuKey, onToggleMenu, hoveredKey, onBack }: ThreadListProps) {
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
              <ThreadRow
                thread={thread}
                href={threadHref(thread.key)}
                onToggleNotify={onToggleNotify && (() => onToggleNotify(thread.key))}
                menuOpen={openMenuKey === thread.key}
                onToggleMenu={() => onToggleMenu?.(thread.key)}
                forceHover={hoveredKey === thread.key}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ThreadRow({
  thread,
  href,
  onToggleNotify,
  menuOpen,
  onToggleMenu,
  forceHover,
}: {
  thread: ThreadListItemView;
  href: string;
  onToggleNotify?: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  forceHover: boolean;
}) {
  const { room, root } = thread;
  // 返信の通知をオフにしたスレッドは、未読があっても強調しない（ADR 0056 決定 2。チャンネルのミュートと同じ）
  const unread = thread.unreadCount > 0 && thread.notifyReplies;
  return (
    <div
      className={cx(
        "group relative flex flex-col gap-1.5 px-4 py-3 md:px-6",
        forceHover || menuOpen ? "bg-surface-muted" : "hover:bg-surface-muted focus-within:bg-surface-muted",
      )}
    >
      {/* 行全体を押せるように、リンクを行の上に広げる。「その他」だけはその上に重ねて押せるようにする（「後で」の一覧と同じ） */}
      <Link href={href} aria-label={`${root.sender.name} のスレッドを開く`} className="absolute inset-0" />
      <span className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1 text-2xs font-medium text-text-secondary">
          {room.kind === "public" && <span aria-label="公開チャンネル">#</span>}
          {room.kind === "private" && (
            <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3" />
          )}
          <span className="truncate">{room.name}</span>
          {/* オフにしていることは、行の見た目だけでは分からないので印を添える（ヘッダーのミュートのベルと同じ） */}
          {!thread.notifyReplies && (
            <BellOffIcon aria-label="返信の通知はオフ" aria-hidden={false} role="img" className="size-3 text-text-muted" />
          )}
        </span>
        {/* 「その他」を出す間はバッジを隠さないよう、ホバーの操作は行の右上に重ねる */}
        {thread.notifyReplies ? (
          <UnreadBadge count={thread.unreadCount} />
        ) : (
          <UnreadBadge count={thread.mentionCount} mention />
        )}
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

      {onToggleNotify && (
        <div
          className={cx(
            // モバイルは常に出すので、右上のバッジに重ならないよう右下（「N 件の返信」の行）に置く
            "absolute right-4 bottom-2 items-center rounded-sm border border-border bg-surface p-0.5 md:top-2 md:right-6 md:bottom-auto",
            forceHover || menuOpen ? "flex" : "hidden group-hover:flex group-focus-within:flex max-md:flex",
          )}
        >
          <IconButton
            label="その他の操作"
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
            className={cx("size-7", menuOpen && "bg-surface-muted")}
          >
            <MoreIcon className="size-4" />
          </IconButton>
        </div>
      )}
      {menuOpen && onToggleNotify && (
        <Popover label="スレッドの操作" className="right-4 bottom-12 w-64 md:top-11 md:right-6 md:bottom-auto" onDismiss={onToggleMenu}>
          <MenuItem icon={thread.notifyReplies ? BellOffIcon : BellIcon} onClick={onToggleNotify}>
            {thread.notifyReplies ? "返信の通知をオフにする" : "新しい返信の通知を受け取る"}
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}
