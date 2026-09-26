import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { BellIcon, BellOffIcon, ChevronLeftIcon, HeadphonesIcon, LockIcon, SettingsIcon, UsersIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import type { HuddleHeaderState, RoomKind } from "./types";

type RoomHeaderProps = {
  kind: RoomKind;
  name: string;
  memberCount: number;
  membersOpen?: boolean;
  onToggleMembers?: () => void;
  /** チャンネルの設定を開く。DM と、設定を開けない人には渡さない（ADR 0011）。 */
  onOpenSettings?: () => void;
  /**
   * ヘッダーの「通知」のアイコン（ADR 0055）。ルームのメンバーだけが設定を持てるので、参加していない public ルームでは渡さない。
   * muted のときはアイコンを斜線入りのベルに替え、ミュートしていることをヘッダーでも分かるようにする。
   */
  notifications?: { muted: boolean; open: boolean; onToggle?: () => void; menu?: ReactNode };
  /** モバイルで一覧に戻る。md 以上では出さない。 */
  onBack?: () => void;
  /** アーカイブされている（ADR 0059）。名前の横にラベルを出す。 */
  archived?: boolean;
  /**
   * ハドルのボタン（ADR 0066 決定 17）。始める・入る・抜けるを 1 つのボタンで切り替える（Slack の ⌘⇧H と同じ）。
   * 入れない人（参加していない public ルーム・アーカイブ済み）には渡さない（決定 7）。
   */
  huddle?: HuddleHeaderState & { onClick?: () => void };
};

export function RoomHeader({
  kind,
  name,
  memberCount,
  membersOpen = false,
  onToggleMembers,
  onOpenSettings,
  notifications,
  onBack,
  archived = false,
  huddle,
}: RoomHeaderProps) {
  return (
    <header className="relative flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 md:pr-3 md:pl-4">
      <IconButton label="チャンネル一覧に戻る" onClick={onBack} className="md:hidden">
        <ChevronLeftIcon className="size-5" />
      </IconButton>
      <div className="min-w-0 flex-1 pl-1 md:pl-0">
        <h1 className="flex items-center gap-1 truncate text-lg font-bold text-text">
          {kind === "public" && <span aria-label="公開チャンネル">#</span>}
          {kind === "private" && <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-4" />}
          <span className="truncate">{name}</span>
          {/* モバイルは幅が足りず名前が切れるので出さない。入力欄の代わりの帯（ArchivedRoomBar）で分かる */}
          {archived && (
            <span className="ml-1 hidden md:block">
              <Badge>アーカイブ済み</Badge>
            </span>
          )}
        </h1>
        <p className="text-2xs text-text-muted">メンバー{memberCount}人</p>
      </div>
      {huddle && <HuddleButton huddle={huddle} />}
      {notifications && (
        // モバイルはヘッダーの右端にそろえてメニューを出す（アイコンの位置に合わせると、画面の左にはみ出す）
        <div className="md:relative">
          <IconButton
            label={notifications.muted ? "通知（ミュート中）" : "通知"}
            onClick={notifications.onToggle}
            aria-expanded={notifications.open}
            aria-haspopup="dialog"
          >
            {notifications.muted ? <BellOffIcon className="size-4" /> : <BellIcon className="size-4" />}
          </IconButton>
          {notifications.open && notifications.menu}
        </div>
      )}
      {onOpenSettings && (
        <IconButton label="チャンネルの設定" onClick={onOpenSettings} className="mr-0.5">
          <SettingsIcon className="size-4" />
        </IconButton>
      )}
      <button
        type="button"
        onClick={onToggleMembers}
        aria-expanded={membersOpen}
        className={cx(
          "inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 text-sm font-medium",
          membersOpen
            ? "border-primary-subtle bg-primary-subtle text-primary"
            : "border-border bg-surface text-text-secondary hover:bg-surface-muted",
        )}
      >
        <UsersIcon className="size-4" />
        メンバー
      </button>
    </header>
  );
}


/**
 * 進行中でなければヘッドフォンのアイコンだけ。進行中は、入っている人のアバターと「参加」（押せるので緑）。
 * 自分が入っていれば緑の地のアイコンにし、押すとハドルのタブを前に出す（Slack の緑のヘッドフォンと同じ。ADR 0066 追記 C）。
 * 抜けるのはハドルの画面の「退出する」から。
 */
function HuddleButton({ huddle }: { huddle: HuddleHeaderState & { onClick?: () => void } }) {
  if (huddle.state === "idle") {
    return (
      <IconButton label="ハドルミーティングを開始する" onClick={huddle.onClick}>
        <HeadphonesIcon className="size-4" />
      </IconButton>
    );
  }
  if (huddle.state === "joined") {
    return (
      <button
        type="button"
        onClick={huddle.onClick}
        aria-label="ハドルミーティングの画面を表示する"
        className="mr-1 inline-flex size-8 items-center justify-center rounded-sm bg-primary text-on-primary hover:bg-primary-hover"
      >
        <HeadphonesIcon className="size-4" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={huddle.onClick}
      aria-label="ハドルミーティングに参加する"
      // モバイルは名前の幅が足りないので、アイコンだけの四角にする
      className="mr-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-primary bg-primary-subtle text-sm font-medium text-primary hover:bg-surface-muted max-md:w-8 md:pr-3 md:pl-2"
    >
      <HeadphonesIcon className="size-4 shrink-0" />
      <span aria-hidden className="hidden -space-x-1.5 md:flex">
        {huddle.participants.slice(0, 3).map((p) => (
          <Avatar key={p.id} id={p.id} name={p.name} imageUrl={p.avatarUrl} size="xs" className="rounded-full ring-2 ring-surface" />
        ))}
      </span>
      <span className="hidden md:inline">参加</span>
    </button>
  );
}
