import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/button";
import { ChevronLeftIcon, LockIcon, PinIcon, SettingsIcon, UsersIcon } from "@/components/ui/icons";
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
  /** モバイルで一覧に戻る。md 以上では出さない。 */
  onBack?: () => void;
  /**
   * ピン留めの一覧を開く（ADR 0054。Slack のヘッダーの「ピン」）。count はピン留めの数で、0 のときも出す
   * （開けば「どうすればピン留めできるか」が分かるため）。渡さなければ出さない。
   */
  pins?: { count: number; open: boolean; onToggle?: () => void };
};

export function RoomHeader({
  kind,
  name,
  memberCount,
  membersOpen = false,
  onToggleMembers,
  onOpenSettings,
  onBack,
  pins,
}: RoomHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 md:pr-3 md:pl-4">
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
      {onOpenSettings && (
        <IconButton label="チャンネルの設定" onClick={onOpenSettings} className="mr-0.5">
          <SettingsIcon className="size-4" />
        </IconButton>
      )}
      {pins && (
        <HeaderToggle label={`ピン留め ${pins.count} 件`} open={pins.open} onClick={pins.onToggle}>
          <PinIcon className="size-4" />
          <span className="font-mono">{pins.count}</span>
        </HeaderToggle>
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

/** ヘッダーの右のパネルを開け閉てするボタン（メンバーと同じ見た目。開いている間は押している状態の緑）。 */
function HeaderToggle({
  label,
  open,
  onClick,
  children,
}: {
  label: string;
  open: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      aria-expanded={open}
      className={cx(
        "mr-1.5 inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-sm font-medium",
        open
          ? "border-primary-subtle bg-primary-subtle text-primary"
          : "border-border bg-surface text-text-secondary hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}
