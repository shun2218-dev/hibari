import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { AlertIcon, ClockIcon, CloseIcon, HashIcon, HeadphonesIcon, LockIcon, MicIcon, MicOffIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { cx } from "@/lib/cx";

import type { HuddleParticipantView, HuddleProblem, HuddleWindowView, RoomKind } from "./types";

/**
 * 入っている間に出すハドルの窓（ADR 0066 決定 17）。Slack の「サイドバーのハドルウィンドウ」に当たり、
 * md 以上はサイドバーの下、モバイルは画面の上の帯（`HuddleMobileBar`）に出す。
 *
 * 色の約束: 押せるもの（ミュート・退出）は既存のボタンの色、話している人と再接続中は「いま起きていること」の琥珀（CLAUDE.md のトークンの決まり）。
 */
export function HuddleWindow({
  huddle,
  onToggleMute,
  onLeave,
}: {
  huddle: HuddleWindowView;
  onToggleMute?: () => void;
  onLeave?: () => void;
}) {
  return (
    <section aria-label="ハドルミーティング" className="border-t border-border bg-surface px-3 pt-3 pb-3">
      <div className="flex items-center gap-2">
        <HeadphonesIcon className="size-4 shrink-0 text-text-secondary" />
        <RoomName room={huddle.room} className="text-sm font-semibold text-text" />
      </div>
      <ConnectionLine huddle={huddle} />

      <ul aria-label="参加者" className="mt-3 flex flex-wrap gap-2">
        {huddle.participants.map((p) => (
          <li key={p.id}>
            <ParticipantAvatar participant={p} />
          </li>
        ))}
      </ul>

      {huddle.joiningSoon.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-1">
          {huddle.joiningSoon.map((user) => (
            <li key={user.id} className="flex items-center gap-1.5 text-xs text-text-secondary">
              <ClockIcon className="size-3.5 shrink-0" />
              <span className="truncate">{user.name} さんがもうすぐ参加します</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2">
        <MuteButton muted={huddle.muted} onClick={onToggleMute} />
        <Button variant="secondary" size="sm" onClick={onLeave} className="ml-auto">
          退出
        </Button>
      </div>
    </section>
  );
}

/**
 * モバイルの帯。ルームを開いている間はサイドバーが隠れるので、画面の上に 1 行で出す（Slack のモバイルの帯と同じ置き場所）。
 * 参加者は重ねたアバターで 3 人まで、それより多ければ人数だけを添える。
 */
export function HuddleMobileBar({
  huddle,
  onToggleMute,
  onLeave,
}: {
  huddle: HuddleWindowView;
  onToggleMute?: () => void;
  onLeave?: () => void;
}) {
  const shown = huddle.participants.slice(0, 3);
  const speaking = huddle.participants.some((p) => p.speaking);
  return (
    <section
      aria-label="ハドルミーティング"
      className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-muted px-3"
    >
      <HeadphonesIcon className={cx("size-4 shrink-0", speaking ? "text-attention" : "text-text-secondary")} />
      <div className="min-w-0 flex-1">
        <RoomName room={huddle.room} className="text-sm font-semibold text-text" />
        <p className="truncate text-2xs text-text-muted">
          {huddle.connection === "connected" ? `${huddle.participants.length} 人が参加中` : connectionText[huddle.connection]}
        </p>
      </div>
      <span className="flex shrink-0 -space-x-1.5">
        {shown.map((p) => (
          <Avatar key={p.id} id={p.id} name={p.name} imageUrl={p.avatarUrl} size="xs" className="rounded-full ring-2 ring-surface-muted" />
        ))}
      </span>
      <MuteButton muted={huddle.muted} onClick={onToggleMute} />
      <Button variant="secondary" size="sm" onClick={onLeave}>
        退出
      </Button>
    </section>
  );
}

/**
 * 入れなかった・外れたときの知らせ（ADR 0066 決定 17）。窓と同じ場所に出し、閉じるまで残す。
 * 入り直せるもの（つながらなかった・外れた・人数が空いた）には「もう一度参加」を出す。
 */
export function HuddleProblemNotice({
  problem,
  room,
  onRetry,
  onClose,
}: {
  problem: HuddleProblem;
  room: { kind: RoomKind; name: string };
  onRetry?: () => void;
  onClose?: () => void;
}) {
  const { title, detail, retry } = problemText[problem];
  return (
    <section aria-label="ハドルミーティング" className="border-t border-border bg-surface px-3 pt-3 pb-3">
      <div role="alert" className="flex items-start gap-2">
        <AlertIcon className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text">{title}</p>
          <RoomName room={room} className="text-2xs text-text-muted" />
          <p className="mt-1 text-xs leading-normal text-text-secondary">{detail}</p>
        </div>
        <IconButton label="閉じる" onClick={onClose} className="-mt-1 -mr-1">
          <CloseIcon className="size-4" />
        </IconButton>
      </div>
      {retry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3 w-full">
          もう一度参加
        </Button>
      )}
    </section>
  );
}

const connectionText = {
  connecting: "接続しています…",
  reconnecting: "再接続しています…",
} as const;

const problemText: Record<HuddleProblem, { title: string; detail: string; retry: boolean }> = {
  "mic-denied": {
    title: "マイクを使えません",
    detail: "ブラウザがマイクの使用を許可していません。アドレスバーのサイトの設定でマイクを許可してから、もう一度参加してください。",
    retry: true,
  },
  "no-mic": {
    title: "マイクが見つかりません",
    detail: "マイクをつないでから、もう一度参加してください。",
    retry: true,
  },
  failed: {
    title: "接続できませんでした",
    detail: "ネットワークを確かめて、もう一度参加してください。",
    retry: true,
  },
  full: {
    title: "参加できる人数の上限に達しています",
    detail: "ハドルミーティングに参加できるのは 20 人までです。",
    retry: true,
  },
  disconnected: {
    title: "ハドルミーティングから切断されました",
    detail: "しばらく接続できなかったため、ハドルミーティングから外れました。",
    retry: true,
  },
  removed: {
    title: "ハドルミーティングから外れました",
    detail: "このチャンネルに参加できなくなったため、ハドルミーティングから外れました。",
    retry: false,
  },
};

function RoomName({ room, className }: { room: { kind: RoomKind; name: string }; className?: string }) {
  return (
    <p className={cx("flex min-w-0 items-center gap-1", className)}>
      {room.kind === "public" && <HashIcon aria-label="公開チャンネル" aria-hidden={false} role="img" className="size-3.5 shrink-0" />}
      {room.kind === "private" && <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3.5 shrink-0" />}
      <span className="truncate">{room.name}</span>
    </p>
  );
}

function ConnectionLine({ huddle }: { huddle: HuddleWindowView }) {
  if (huddle.connection === "connected") {
    return <p className="mt-0.5 text-2xs text-text-muted">{huddle.participants.length} 人が参加中</p>;
  }
  return (
    <p
      role="status"
      className={cx(
        "mt-0.5 flex items-center gap-1.5 text-2xs",
        // 切れてつなぎ直しているのは「いま起きていること」（接続状態のバナーと同じ琥珀。ADR 0004）
        huddle.connection === "reconnecting" ? "text-attention-text" : "text-text-muted",
      )}
    >
      <Spinner className="size-3" />
      {connectionText[huddle.connection]}
    </p>
  );
}

/**
 * 参加者のアバター。話している人は琥珀の輪（Slack と同じくアバターの周り）、ミュートしている人は右下にマイクの斜線を重ねる。
 * 名前は吹き出しではなく読み上げと title で出す（窓が狭く、並べると 2 人ぶんしか入らないため）。
 */
function ParticipantAvatar({ participant: p }: { participant: HuddleParticipantView }) {
  const state = [p.speaking ? "話しています" : undefined, p.muted ? "ミュート中" : undefined].filter(Boolean).join("・");
  return (
    <span
      role="img"
      aria-label={state ? `${p.name}（${state}）` : p.name}
      title={p.name}
      className="relative inline-flex"
    >
      {/* 輪とアバターの間に隙間を空けるため、外側の枠に輪を描く（話していないときは透明にして、並びの位置を動かさない） */}
      <span className={cx("rounded-full p-0.5 ring-2", p.speaking ? "ring-attention" : "ring-transparent")}>
        <Avatar id={p.id} name={p.name} imageUrl={p.avatarUrl} size="md" />
      </span>
      {p.muted && (
        <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-surface-muted text-text-secondary ring-2 ring-surface">
          <MicOffIcon className="size-3" />
        </span>
      )}
    </span>
  );
}

/**
 * マイクの切り替え。Slack の窓と同じくアイコンだけにし、ミュート中は押せば戻せることを緑の地で強く見せる。
 * 押したときの操作を名前にする（「ミュート」/「ミュートを解除」）。ショートカットは ⌘⇧Space（決定 17）。
 */
function MuteButton({ muted, onClick }: { muted: boolean; onClick?: () => void }) {
  const label = muted ? "ミュートを解除" : "ミュート";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={muted}
      aria-label={label}
      title={`${label}（⌘⇧Space）`}
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-sm border",
        muted ? "border-primary bg-primary-subtle text-primary" : "border-border bg-surface text-text-secondary hover:bg-surface-muted",
      )}
    >
      {muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
    </button>
  );
}
