import { IconButton } from "@/components/ui/button";
import { ChevronLeftIcon, LockIcon, UsersIcon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

import type { RoomKind } from "./types";

type RoomHeaderProps = {
  kind: RoomKind;
  name: string;
  memberCount: number;
  membersOpen?: boolean;
  onToggleMembers?: () => void;
  /** モバイルで一覧に戻る。md 以上では出さない。 */
  onBack?: () => void;
};

export function RoomHeader({ kind, name, memberCount, membersOpen = false, onToggleMembers, onBack }: RoomHeaderProps) {
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
