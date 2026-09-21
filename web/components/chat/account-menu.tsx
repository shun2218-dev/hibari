import { SmilePlusIcon } from "@/components/ui/icons";
import { Popover } from "@/components/ui/popover";

import type { UserRef } from "./types";

type AccountMenuProps = {
  user: UserRef & { handle: string };
  /** 自分が手動で離席にしている（ADR 0049）。自動の離席はここに出さない（自分で戻せるものだけを操作にする）。 */
  away?: boolean;
  onOpenStatus?: () => void;
  onToggleAway?: () => void;
  onOpenWorkspaceSettings?: () => void;
  onOpenSettings?: () => void;
  onLogout?: () => void;
};

/**
 * サイドバーの自分のアバターから開くメニュー。ステータス・離席・ワークスペース設定・設定・ログアウトへの入口。
 * ワークスペース設定は member でも開ける（読み取り専用で見せる。ADR 0006）。
 */
export function AccountMenu({
  user,
  away = false,
  onOpenStatus,
  onToggleAway,
  onOpenWorkspaceSettings,
  onOpenSettings,
  onLogout,
}: AccountMenuProps) {
  return (
    <Popover label="アカウント" className="top-14 right-3 w-58">
      <div className="flex flex-col gap-0.5 px-2.5 pt-1.5 pb-2">
        <span className="text-base font-semibold text-text">{user.name}</span>
        <span className="font-mono text-2xs text-text-muted">@{user.handle}</span>
      </div>
      <div className="my-1.5 h-px bg-border" />
      {/* ステータスは、いま出ているものをそのまま押して変えられるようにする（Slack と同じ） */}
      <button
        type="button"
        onClick={onOpenStatus}
        className="flex h-9.5 w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 text-left text-base text-text hover:bg-surface-muted"
      >
        {user.status ? (
          <>
            <span role="img" aria-hidden>
              {user.status.emoji}
            </span>
            <span className="truncate">{user.status.text ?? "ステータスを変更"}</span>
          </>
        ) : (
          <>
            <SmilePlusIcon className="size-4 text-text-secondary" />
            ステータスを設定
          </>
        )}
      </button>
      <button
        type="button"
        onClick={onToggleAway}
        className="flex h-9.5 w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 text-left text-base text-text hover:bg-surface-muted"
      >
        <span aria-hidden className="size-2 rounded-full border-2 border-text-muted bg-surface" />
        {away ? "離席を解除する" : "離席中にする"}
      </button>
      <div className="my-1.5 h-px bg-border" />
      <button
        type="button"
        onClick={onOpenWorkspaceSettings}
        className="flex h-9.5 w-full items-center rounded-sm px-2.5 text-left text-base text-text hover:bg-surface-muted"
      >
        ワークスペース設定
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex h-9.5 w-full items-center rounded-sm px-2.5 text-left text-base text-text hover:bg-surface-muted"
      >
        設定
      </button>
      <div className="my-1.5 h-px bg-border" />
      <button
        type="button"
        onClick={onLogout}
        className="flex h-9.5 w-full items-center rounded-sm px-2.5 text-left text-base font-medium text-danger hover:bg-surface-muted"
      >
        ログアウト
      </button>
    </Popover>
  );
}
