import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { HashIcon, HeadphonesIcon, LockIcon } from "@/components/ui/icons";

import type { HuddleLinkCardView } from "./types";

/**
 * 本文に貼られたハドルのリンクのカード（ADR 0067 決定 2）。形は Slack の実物に合わせる:
 * 上の段にヘッドフォンのアイコン・「ハドルミーティングのリンクが共有されました」・「#ルーム 内」、下の段にボタン。
 *
 * メッセージのリンクのカード（ADR 0040）と違い、中身は生きた状態を映す（「いま進行中か」が本題なので）。
 * 描き分けはデータ層が決めた `huddle` と `canJoin` だけで行う。入れない人にはボタンを出さない。
 */
export function HuddleLinkCard({
  card,
  onOpen,
  onShowScreen,
}: {
  card: HuddleLinkCardView;
  /** 「開始する」「参加する」。ハドルのリンクを開くのと同じ（参加前のプレビューを通す。決定 1）。 */
  onOpen?: () => void;
  /** 「参加中」。ハドルの画面を前に出す。 */
  onShowScreen?: () => void;
}) {
  if (card.state === "loading") {
    // 読み込めたときに高さが大きく変わってタイムラインがずれないよう、枠だけ先に置く（メッセージのリンクのカードと同じ）
    return <div aria-hidden className="h-18 max-w-150 rounded-md border border-border bg-surface-muted" />;
  }
  if (card.state === "unavailable") {
    return (
      <div className="flex max-w-150 items-center gap-3 rounded-md border border-border bg-surface px-3.5 py-3">
        <Icon />
        <p className="text-sm text-text-muted italic">アクセスできないハドルミーティング</p>
      </div>
    );
  }
  const { room, huddle } = card;
  return (
    <article aria-label="ハドルミーティングのリンク" className="max-w-150 overflow-hidden rounded-md border border-border bg-surface">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Icon />
        <div className="min-w-0">
          <p className="text-base font-semibold text-text">ハドルミーティングのリンクが共有されました</p>
          <p className="flex min-w-0 items-center gap-0.5 text-sm text-text-secondary">
            {card.workspaceName && <span className="truncate">{card.workspaceName} /</span>}
            {room.kind === "public" && <HashIcon aria-label="公開チャンネル" aria-hidden={false} role="img" className="size-3.5 shrink-0" />}
            {room.kind === "private" && <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3.5 shrink-0" />}
            <span className="truncate font-medium text-text">{room.name}</span>
            <span className="shrink-0">内</span>
          </p>
        </div>
      </div>

      {huddle ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-attention-subtle px-3.5 py-2.5">
          {/* 進行中は「いま起きていること」の琥珀（会話のハドルのメッセージと同じ） */}
          <span className="rounded-sm bg-attention px-1.5 text-2xs font-semibold text-on-attention">ライブ</span>
          <span aria-hidden className="flex shrink-0 -space-x-1">
            {huddle.participants.slice(0, 5).map((p) => (
              <Avatar key={p.id} id={p.id} name={p.name} imageUrl={p.avatarUrl} size="xs" className="rounded-full ring-2 ring-attention-subtle" />
            ))}
          </span>
          <span className="min-w-0 flex-1 text-sm text-text-secondary">{huddle.participants.length} 人が参加中</span>
          {huddle.joined ? (
            <Button variant="secondary" size="sm" onClick={onShowScreen} className="gap-1.5">
              <HeadphonesIcon className="size-4" />
              参加中
            </Button>
          ) : (
            card.canJoin && (
              <Button size="sm" onClick={onOpen} className="gap-1.5">
                <HeadphonesIcon className="size-4" />
                参加する
              </Button>
            )
          )}
        </div>
      ) : (
        card.canJoin && (
          <div className="border-t border-border bg-surface-muted px-3.5 py-2.5">
            <Button size="sm" onClick={onOpen} className="gap-1.5">
              <HeadphonesIcon className="size-4" />
              ハドルミーティングを開始する
            </Button>
          </div>
        )
      )}
    </article>
  );
}

function Icon() {
  return (
    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-muted text-text-secondary">
      <HeadphonesIcon className="size-5" />
    </span>
  );
}
