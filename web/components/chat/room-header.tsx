import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/button";
import { BellIcon, BellOffIcon, ChevronLeftIcon, LockIcon, SettingsIcon, UsersIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import type { RoomKind } from "./types";

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
        </h1>
        <p className="text-2xs text-text-muted">メンバー{memberCount}人</p>
      </div>
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

