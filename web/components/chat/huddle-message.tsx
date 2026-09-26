import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { HeadphonesIcon, PhoneMissedIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import { ThreadSummary } from "./message-item/thread-summary";
import type { HuddleMessageView } from "./types";

/**
 * 会話に残すハドルのメッセージ（ADR 0066 決定 12・追記 D）。
 *
 * Slack と同じく、人の発言のアバターの代わりにヘッドフォンのアイコンを置いた行にする。進行中は見出しの横に「ライブ」、
 * 終わったら所要時間と参加した人。下にハドルのチャット（スレッド）の「N 件の返信」を出す（追記 A）。
 * 見る人で変わる見え方（不在着信・応答なし・参加中）は、データ層が `state` と `joined` で決めて渡す。
 */
export function HuddleMessage({
  huddle,
  onJoin,
  onOpenThread,
  threadOpen = false,
}: {
  huddle: HuddleMessageView;
  onJoin?: () => void;
  onOpenThread?: () => void;
  /** このハドルのチャットを右のパネルで開いている（普通のスレッドの親と同じく地を緑にする）。 */
  threadOpen?: boolean;
}) {
  const live = huddle.state === "active";
  const missed = huddle.state === "missed" || huddle.state === "unanswered";
  return (
    <article
      aria-label={`${title(huddle)} ${huddle.timeLabel}`}
      className={cx(
        "flex gap-2.5 px-3 pt-3 pb-1 md:gap-3 md:px-4",
        // 開いているスレッドの緑を優先し、進行中は行ごと琥珀の地にする（Slack も進行中の行に地の色を付ける）
        threadOpen ? "bg-primary-subtle" : live && "bg-attention-subtle",
      )}
    >
      <span
        className={cx(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md md:size-10",
          // 進行中は「いま起きていること」の琥珀（Slack は緑だが、hibari の緑は押せるものの色）
          live ? "bg-attention text-on-attention" : "bg-surface-muted text-text-secondary",
        )}
      >
        {missed ? <PhoneMissedIcon className="size-4 md:size-5" /> : <HeadphonesIcon className="size-4 md:size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-x-2">
          <span className="text-sm font-semibold text-text">{title(huddle)}</span>
          {live && (
            <span className="rounded-sm bg-attention px-1.5 text-2xs font-semibold text-on-attention">ライブ</span>
          )}
          <time className="font-mono text-2xs text-text-muted">{huddle.timeLabel}</time>
        </header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="flex min-w-0 items-center gap-1.5 text-lg leading-relaxed text-text-secondary">
            {/* 進行中は、いま入っている人を顔で見せる（誰がいるかで入るかを決めるため） */}
            {live && huddle.participants.length > 0 && (
              <span aria-hidden className="flex shrink-0 -space-x-1">
                {huddle.participants.slice(0, 5).map((p) => (
                  <Avatar
                    key={p.id}
                    id={p.id}
                    name={p.name}
                    imageUrl={p.avatarUrl}
                    size="xs"
                    // 重ねた顔の縁は、行の地の色に合わせる
                    className={cx("rounded-full ring-2", threadOpen ? "ring-primary-subtle" : "ring-attention-subtle")}
                  />
                ))}
              </span>
            )}
            <span className="min-w-0">{detail(huddle)}</span>
          </p>
          {/* 入る操作が渡されていなければ（入れない人・ハドルが無効）、ボタンを出さない */}
          {live && !huddle.joined && onJoin && (
            <Button size="sm" onClick={onJoin} className="shrink-0">
              <HeadphonesIcon className="size-4" />
              参加
            </Button>
          )}
        </div>
        {huddle.thread && <ThreadSummary thread={huddle.thread} onOpen={onOpenThread} />}
      </div>
    </article>
  );
}

function title(huddle: HuddleMessageView) {
  switch (huddle.state) {
    case "active":
      return "ハドルミーティング";
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
      return huddle.joined ? `参加中 · ${huddle.participantsLabel ?? ""}` : (huddle.participantsLabel ?? "");
    case "ended":
      return [huddle.durationLabel, huddle.participantsLabel].filter(Boolean).join(" · ");
    case "missed":
      return `${huddle.starter.name} さんからのハドルミーティング`;
    case "unanswered":
      return "相手は参加しませんでした";
  }
}
