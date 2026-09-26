import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  AlertIcon,
  ChevronDownIcon,
  ClockIcon,
  HashIcon,
  HeadphonesIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  PopOutIcon,
  ThreadIcon,
} from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { cx } from "@/lib/cx";

import type { HuddleParticipantView, HuddleProblem, HuddleScreenView, RoomKind } from "./types";

/**
 * ハドルの画面（ADR 0066 追記 C）。チャットのタブが開いた別のタブ（about:blank）に、チャットのタブから描く。
 * モバイルと、タブを開けなかったときは、同じタブの全画面に出す。
 *
 * 上に「#ルーム でハドルミーティングを行う」と人数、中央に参加者のタイル、下に操作の列、右にハドルのチャット（追記 A）。
 * 色の約束: 押せるもの（マイク・チャット）は緑、話している人と再接続中は「いま起きていること」の琥珀、「退出する」は danger。
 */
export function HuddleScreen({
  huddle,
  chat,
  chatOpen = false,
  deviceMenu,
  onToggleMute,
  onToggleDeviceMenu,
  onToggleChat,
  onLeave,
}: {
  huddle: HuddleScreenView;
  /** ハドルのチャット（ハドルのメッセージのスレッド）。`ThreadPanel` を渡す。 */
  chat?: ReactNode;
  chatOpen?: boolean;
  /** マイクとスピーカーの選択（下の列のマイクの横の「⌄」で開く）。開いているときだけ渡す。 */
  deviceMenu?: ReactNode;
  onToggleMute?: () => void;
  onToggleDeviceMenu?: () => void;
  onToggleChat?: () => void;
  onLeave?: () => void;
}) {
  const tiles = layout(huddle.participants.length);
  return (
    <div className="flex h-dvh flex-col bg-background">
      <ScreenHeader room={huddle.room}>
        <ConnectionLabel huddle={huddle} />
      </ScreenHeader>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <ul aria-label="参加者" className={cx("grid min-h-0 flex-1 content-center gap-3 overflow-y-auto p-4 md:p-6", tiles.grid)}>
            {huddle.participants.map((p) => (
              <li key={p.id}>
                <ParticipantTile participant={p} className={tiles.tile} />
              </li>
            ))}
          </ul>

          {huddle.joiningSoon.length > 0 && (
            <ul className="flex flex-wrap justify-center gap-2 px-4 pb-3">
              {huddle.joiningSoon.map((user) => (
                <li key={user.id} className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs text-text-secondary">
                  <ClockIcon className="size-3.5 shrink-0" />
                  {user.name} さんがもうすぐ参加します
                </li>
              ))}
            </ul>
          )}

          <div className="flex h-16 shrink-0 items-center gap-2 border-t border-border bg-surface px-3 md:px-4">
            <div className="flex flex-1 justify-center">
              <HuddleControls
                muted={huddle.muted}
                chatOpen={chatOpen}
                deviceMenu={deviceMenu}
                onToggleMute={onToggleMute}
                onToggleDeviceMenu={onToggleDeviceMenu}
                onToggleChat={onToggleChat}
              />
            </div>
            <Button variant="danger" onClick={onLeave} className="shrink-0">
              退出する
            </Button>
          </div>
        </main>
        {chatOpen && chat}
      </div>
    </div>
  );
}

/**
 * ハドルの帯（ADR 0066 追記 C）。ハドルのタブを開いていない間、チャットのタブの下の端に全幅で出す（Slack と同じ）。
 * ハドルの画面と同じ操作の列に、「新しいウィンドウで開く」（タブを開き直す）と「退出する」を添える。
 * モバイルは幅が足りないので、ルーム名と操作だけを 2 段に並べる。
 */
export function HuddleBar({
  huddle,
  chatOpen = false,
  deviceMenu,
  onToggleMute,
  onToggleDeviceMenu,
  onToggleChat,
  onPopOut,
  onLeave,
}: {
  huddle: HuddleScreenView;
  /** チャットのタブの右のパネルで、ハドルのチャット（スレッド）を開いている。 */
  chatOpen?: boolean;
  deviceMenu?: ReactNode;
  onToggleMute?: () => void;
  onToggleDeviceMenu?: () => void;
  onToggleChat?: () => void;
  onPopOut?: () => void;
  onLeave?: () => void;
}) {
  const others = huddle.participants.slice(1);
  return (
    <section
      aria-label="ハドルミーティング"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-surface px-3 py-2.5 md:flex-nowrap md:px-4"
    >
      {/* モバイルは 1 段目を全幅にして、操作を 2 段目に回す */}
      <div className="flex w-full min-w-0 items-center gap-2.5 md:w-auto md:flex-1 md:basis-0">
        <span aria-hidden className="flex shrink-0 -space-x-2">
          {(others.length > 0 ? others : huddle.participants).slice(0, 3).map((p) => (
            <Avatar key={p.id} id={p.id} name={p.name} imageUrl={p.avatarUrl} size="sm" className="rounded-full ring-2 ring-surface" />
          ))}
        </span>
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1 text-sm text-text">
            <RoomName room={huddle.room} />
            <span className="shrink-0 text-text-secondary">でのハドルミーティング</span>
          </p>
          <p className="truncate text-xs text-text-muted">
            {huddle.connection === "connected" ? (
              others.length === 0 ? "ほかの参加者はいません" : `${huddle.participants.length} 人が参加中`
            ) : (
              <ConnectionLabel huddle={huddle} />
            )}
          </p>
        </div>
      </div>
      <HuddleControls
        muted={huddle.muted}
        chatOpen={chatOpen}
        deviceMenu={deviceMenu}
        onToggleMute={onToggleMute}
        onToggleDeviceMenu={onToggleDeviceMenu}
        onToggleChat={onToggleChat}
      />
      <div className="ml-auto flex items-center justify-end gap-2 md:ml-0 md:flex-1 md:basis-0">
        <button
          type="button"
          onClick={onPopOut}
          aria-label="ハドルミーティングを新しいウィンドウで開く"
          title="ハドルミーティングを新しいウィンドウで開く"
          className="flex size-10 items-center justify-center rounded-md border border-border bg-surface text-text hover:bg-surface-muted"
        >
          <PopOutIcon className="size-5" />
        </button>
        <Button variant="danger" onClick={onLeave}>
          退出する
        </Button>
      </div>
    </section>
  );
}

/** ハドルの画面と帯で共有する操作の列（マイクと機器の選択・ハドルのチャット）。 */
function HuddleControls({
  muted,
  chatOpen,
  deviceMenu,
  onToggleMute,
  onToggleDeviceMenu,
  onToggleChat,
}: {
  muted: boolean;
  chatOpen: boolean;
  deviceMenu?: ReactNode;
  onToggleMute?: () => void;
  onToggleDeviceMenu?: () => void;
  onToggleChat?: () => void;
}) {
  return (
    <div role="toolbar" aria-label="ハドルミーティングの操作" className="flex gap-2">
      <div className="relative flex">
        <button
          type="button"
          onClick={onToggleMute}
          aria-pressed={muted}
          aria-label={muted ? "ミュートを解除" : "ミュート"}
          title={`${muted ? "ミュートを解除" : "ミュート"}（⌘⇧Space）`}
          className={cx(
            "flex h-10 w-11 items-center justify-center rounded-l-md border",
            muted ? "border-primary bg-primary-subtle text-primary" : "border-border bg-surface text-text hover:bg-surface-muted",
          )}
        >
          {muted ? <MicOffIcon className="size-5" /> : <MicIcon className="size-5" />}
        </button>
        <button
          type="button"
          onClick={onToggleDeviceMenu}
          aria-label="マイクとスピーカーを選ぶ"
          aria-expanded={deviceMenu !== undefined}
          aria-haspopup="menu"
          className="flex h-10 w-7 items-center justify-center rounded-r-md border border-l-0 border-border bg-surface text-text-secondary hover:bg-surface-muted"
        >
          <ChevronDownIcon className="size-4" />
        </button>
        {deviceMenu}
      </div>
      <button
        type="button"
        onClick={onToggleChat}
        aria-pressed={chatOpen}
        aria-label="ハドルのチャット"
        className={cx(
          "flex size-10 items-center justify-center rounded-md border",
          chatOpen ? "border-primary bg-primary-subtle text-primary" : "border-border bg-surface text-text hover:bg-surface-muted",
        )}
      >
        <ThreadIcon className="size-5" />
      </button>
    </div>
  );
}

/**
 * 入れなかった・外れたとき（ADR 0066 決定 17）。ハドルの画面の代わりに同じタブへ出す。
 * 入り直せるもの（つながらなかった・外れた・人数が空いた）には「もう一度参加」を付ける。閉じるとタブを閉じる。
 */
export function HuddleProblemScreen({
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
    <div className="flex h-dvh flex-col bg-background">
      <ScreenHeader room={room} />
      <main className="flex flex-1 items-center justify-center p-4">
        <section role="alert" className="flex w-full max-w-100 flex-col items-center gap-2 rounded-lg border border-border bg-surface px-6 py-8 text-center">
          <AlertIcon className="size-6 text-danger" />
          <h1 className="text-base font-semibold text-text">{title}</h1>
          <p className="text-sm leading-normal text-text-secondary">{detail}</p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              閉じる
            </Button>
            {retry && <Button onClick={onRetry}>もう一度参加</Button>}
          </div>
        </section>
      </main>
    </div>
  );
}

const problemText: Record<HuddleProblem, { title: string; detail: string; retry: boolean }> = {
  failed: { title: "接続できませんでした", detail: "ネットワークを確かめて、もう一度参加してください。", retry: true },
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

/**
 * 人数に合わせて、タイルが画面に収まる列の数と高さにする（20 人まで。決定 7）。
 * 縦横比のユーティリティ（`aspect-video`）は既定のテーマを捨てているので使えず（CLAUDE.md のトークンの決まり）、高さで決める。
 */
function layout(count: number): { grid: string; tile: string } {
  if (count <= 1) return { grid: "mx-auto w-full max-w-160 grid-cols-1", tile: "h-72" };
  if (count <= 4) return { grid: "mx-auto w-full max-w-240 grid-cols-2", tile: "h-40 md:h-52" };
  if (count <= 9) return { grid: "grid-cols-2 md:grid-cols-3", tile: "h-36 md:h-40" };
  return { grid: "grid-cols-3 md:grid-cols-5", tile: "h-28 md:h-32" };
}

function ScreenHeader({ room, children }: { room: { kind: RoomKind; name: string }; children?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-center gap-2 border-b border-border bg-surface px-4 text-sm">
      <HeadphonesIcon className="size-4 shrink-0 text-text-secondary" />
      <h1 className="flex min-w-0 items-center gap-1 text-text">
        <RoomName room={room} />
        <span className="shrink-0 text-text-secondary">でハドルミーティングを行う</span>
      </h1>
      {children}
    </header>
  );
}

function RoomName({ room }: { room: { kind: RoomKind; name: string } }) {
  return (
    <span className="flex min-w-0 items-center gap-0.5 font-semibold">
      {room.kind === "public" && <HashIcon aria-label="公開チャンネル" aria-hidden={false} role="img" className="size-3.5 shrink-0" />}
      {room.kind === "private" && <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3.5 shrink-0" />}
      <span className="truncate">{room.name}</span>
    </span>
  );
}

function ConnectionLabel({ huddle }: { huddle: HuddleScreenView }) {
  if (huddle.connection === "connected") {
    return <span className="shrink-0 font-mono text-xs text-text-muted">{huddle.participants.length} 人</span>;
  }
  return (
    <span
      role="status"
      className={cx(
        "flex shrink-0 items-center gap-1.5 text-xs",
        // 切れてつなぎ直しているのは「いま起きていること」（接続状態のバナーと同じ琥珀。ADR 0004）
        huddle.connection === "reconnecting" ? "text-attention-text" : "text-text-muted",
      )}
    >
      <Spinner className="size-3" />
      {huddle.connection === "reconnecting" ? "再接続しています…" : "接続しています…"}
    </span>
  );
}

/**
 * 参加者のタイル。音声だけなのでアバターを大きく出し、左下に名前、右下にミュートの印。
 * 話している人はタイルの枠を琥珀にする（Slack もタイルの枠で示す）。
 */
function ParticipantTile({ participant: p, className }: { participant: HuddleParticipantView; className?: string }) {
  const state = [p.speaking ? "話しています" : undefined, p.muted ? "ミュート中" : undefined].filter(Boolean).join("・");
  return (
    <figure
      aria-label={state ? `${p.name}（${state}）` : p.name}
      className={cx(
        "relative flex items-center justify-center rounded-lg bg-surface ring-2",
        className,
        p.speaking ? "ring-attention" : "ring-transparent",
      )}
    >
      <Avatar id={p.id} name={p.name} imageUrl={p.avatarUrl} size="xl" />
      {/* 右はミュートの印の場所を空けておく */}
      <figcaption className="absolute right-10 bottom-2 left-2 flex">
        <span className="truncate rounded-sm bg-surface-muted px-2 py-0.5 text-xs font-medium text-text">{p.name}</span>
      </figcaption>
      {p.muted && (
        <span className="absolute right-2 bottom-2 flex size-6 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
          <MicOffIcon className="size-3.5" />
        </span>
      )}
    </figure>
  );
}
