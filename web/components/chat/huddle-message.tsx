import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { HeadphonesIcon, PhoneMissedIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import type { HuddleMessageView } from "./types";

/**
 * 会話に残すハドルのメッセージ（ADR 0066 決定 12）。
 *
 * ほかのシステムメッセージ（ADR 0033）は中央寄せの 1 行だが、これは「参加」のボタンと参加者を持つので、
 * 人の発言と同じく始めた人のアバターと名前の行にし、その下にカードを置く（Slack もハドルのメッセージは始めた人の発言の形）。
 * 見る人で変わる見え方（不在着信・応答なし・参加中）は、データ層が `state` と `joined` で決めて渡す。
 */
export function HuddleMessage({ huddle, onJoin }: { huddle: HuddleMessageView; onJoin?: () => void }) {
  const { starter } = huddle;
  const missed = huddle.state === "missed" || huddle.state === "unanswered";
  return (
    <article aria-label={`${starter.name} ${huddle.timeLabel}`} className="flex gap-2.5 px-3 pt-3 pb-1 md:gap-3 md:px-4">
      <Avatar id={starter.id} name={starter.name} imageUrl={starter.avatarUrl} size="message" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <header className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-text">{starter.name}</span>
          <time className="font-mono text-2xs text-text-muted">{huddle.timeLabel}</time>
        </header>
        <p className="text-lg leading-relaxed text-text-secondary">ハドルミーティングを開始しました</p>

        <div className="mt-1.5 flex max-w-120 items-center gap-3 rounded-md border border-border px-3 py-2.5">
          <span
            className={cx(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              // 進行中は「いま起きていること」の琥珀。押せるのは右の「参加」のボタンだけ
              huddle.state === "active" ? "bg-attention-subtle text-attention-text" : "bg-surface-muted text-text-secondary",
            )}
          >
            {missed ? <PhoneMissedIcon className="size-4" /> : <HeadphonesIcon className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-text">{title(huddle)}</p>
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
              {/* 進行中は、いま入っている人を顔で見せる（誰がいるかで入るかを決めるため） */}
              {huddle.state === "active" && (
                <span aria-hidden className="flex shrink-0 -space-x-1">
                  {huddle.participants.slice(0, 5).map((p) => (
                    <Avatar key={p.id} id={p.id} name={p.name} imageUrl={p.avatarUrl} size="xs" className="rounded-full ring-2 ring-surface" />
                  ))}
                </span>
              )}
              <span className="truncate">{detail(huddle)}</span>
            </p>
          </div>
          {huddle.state === "active" &&
            (huddle.joined ? (
              <span className="shrink-0 text-xs font-medium text-text-muted">参加中</span>
            ) : (
              <Button size="sm" onClick={onJoin} className="shrink-0">
                <HeadphonesIcon className="size-4" />
                参加
              </Button>
            ))}
        </div>
      </div>
    </article>
  );
}

function title(huddle: HuddleMessageView) {
  switch (huddle.state) {
    case "active":
      return "ハドルミーティング中";
    case "ended":
      return "ハドルミーティングは終了しました";
    case "missed":
      return "不在着信";
    case "unanswered":
      return "応答なし";
  }
}

function detail(huddle: HuddleMessageView) {
  switch (huddle.state) {
    case "active":
      return `${huddle.participants.map((p) => p.name).join("、")} が参加中`;
    case "ended":
      return [huddle.durationLabel, huddle.participantsLabel].filter(Boolean).join(" · ");
    case "missed":
      return `${huddle.starter.name} さんからのハドルミーティング`;
    case "unanswered":
      return "相手は参加しませんでした";
  }
}
