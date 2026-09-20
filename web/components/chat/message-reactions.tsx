import { SmilePlusIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { reactionNamesLabel } from "@/lib/chat/reactions";

import type { MessageReactionView } from "./types";

type MessageReactionsProps = {
  reactions: MessageReactionView[];
  /** チップを押した（付いていれば外す。ADR 0044 の PUT / DELETE）。 */
  onToggle?: (emoji: string) => void;
  /** 行末の「＋」を押した（ピッカーを開く）。渡さなければ「＋」を出さない（投稿できない人）。 */
  onAdd?: () => void;
  /** ホバーの名前を固定で出す絵文字（story で状態を再現するため）。 */
  forceHoverEmoji?: string;
};

/**
 * メッセージの下に並ぶ絵文字のリアクション（ADR 0044）。
 *
 * チップは押せる要素なので、自分が付けている状態を緑で示す（docs/ui/tokens.md の「緑 = 操作できるもの」）。
 * 未読や入力中と違って「いま起きていること」ではないので、琥珀は使わない。
 *
 * 数は props の値をそのまま出す。楽観的更新（ADR 0044 決定 8）で先に動かすのはデータ層の仕事で、
 * ここは受け取った数を描くだけにする。
 */
export function MessageReactions({ reactions, onToggle, onAdd, forceHoverEmoji }: MessageReactionsProps) {
  if (reactions.length === 0 && onAdd === undefined) return null;

  return (
    <ul className="mt-1.5 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => (
        <li key={reaction.emoji} className="group/reaction relative">
          <button
            type="button"
            // 押すと外れる「付いている状態」なので、チェックボックスと同じ aria-pressed で伝える
            aria-pressed={reaction.me}
            aria-label={reactionNamesLabel(reaction)}
            onClick={() => onToggle?.(reaction.emoji)}
            className={cx(
              "flex h-7 items-center gap-1.5 rounded-full border px-2 transition-colors",
              reaction.me
                ? "border-primary bg-primary-subtle text-primary"
                : "border-border bg-surface text-text-secondary hover:border-text-muted",
            )}
          >
            <span aria-hidden className="text-base leading-none">
              {reaction.emoji}
            </span>
            <span aria-hidden className="font-mono text-2xs font-semibold">
              {reaction.count}
            </span>
          </button>
          {/* 誰が付けたかは、押す前に分かる必要がある（同じ絵文字をもう 1 つ足してしまわないように）。
              読み上げにはボタンの aria-label で同じことを伝えてあるので、この吹き出しは aria-hidden にする。 */}
          <span
            aria-hidden
            className={cx(
              "absolute bottom-full left-0 z-30 mb-1.5 w-max max-w-60 rounded-sm border border-border bg-surface px-2 py-1 text-2xs leading-normal text-text shadow-overlay",
              forceHoverEmoji === reaction.emoji ? "block" : "hidden group-hover/reaction:block",
            )}
          >
            {reactionNamesLabel(reaction)}
          </span>
        </li>
      ))}
      {onAdd !== undefined && (
        <li>
          <button
            type="button"
            aria-label="リアクションを追加"
            onClick={onAdd}
            className="flex h-7 items-center rounded-full border border-border bg-surface px-2 text-text-muted hover:border-text-muted hover:text-text-secondary"
          >
            <SmilePlusIcon className="size-4" />
          </button>
        </li>
      )}
    </ul>
  );
}
