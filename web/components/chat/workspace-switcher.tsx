import { Avatar } from "@/components/ui/avatar";
import { PlusIcon } from "@/components/ui/icons";
import { LogoMark } from "@/components/ui/logo";
import { Popover } from "@/components/ui/popover";
import { cx } from "@/lib/cx";

import type { WorkspaceRef } from "./types";

type WorkspaceSwitcherProps = {
  workspaces: WorkspaceRef[];
  currentWorkspaceId: string;
  onSelect?: (workspaceId: string) => void;
  onCreate?: () => void;
  /** 外を押す・Esc で閉じる。 */
  onDismiss?: () => void;
  /** どこから開くか。header はサイドバーの上のワークスペース名、rail は md 以上の左のメニューの上のアイコン（ADR 0058）。 */
  placement?: "header" | "rail";
};

export function WorkspaceSwitcher({
  workspaces,
  currentWorkspaceId,
  onSelect,
  onCreate,
  onDismiss,
  placement = "header",
}: WorkspaceSwitcherProps) {
  return (
    <Popover
      label="ワークスペースを切り替える"
      className={placement === "rail" ? "top-0 left-full ml-8 w-60" : "top-14 left-3 w-60"}
      onDismiss={onDismiss}
    >
      <p className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1">
        <LogoMark className="size-4" />
        <span className="text-sm font-bold text-text">hibari</span>
        <span className="font-mono text-2xs text-text-muted">workspaces</span>
      </p>
      <ul>
        {workspaces.map((workspace) => {
          const current = workspace.id === currentWorkspaceId;
          return (
            <li key={workspace.id}>
              <button
                type="button"
                onClick={() => onSelect?.(workspace.id)}
                aria-current={current ? "true" : undefined}
                className={cx(
                  "flex h-10 w-full items-center gap-2 rounded-sm px-2.5 text-left",
                  current ? "bg-primary-subtle" : "hover:bg-surface-muted",
                )}
              >
                <Avatar id={workspace.id} name={workspace.name} size="xs" shape="square" />
                <span className="flex-1 truncate text-base font-medium text-text">{workspace.name}</span>
                {current && <span className="text-2xs font-semibold text-primary">現在</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="my-1.5 h-px bg-border" />
      <button
        type="button"
        onClick={onCreate}
        className="flex h-9 w-full items-center gap-2 rounded-sm px-2.5 text-sm font-medium text-primary hover:bg-surface-muted"
      >
        <PlusIcon className="size-4" />
        ワークスペースを作成
      </button>
    </Popover>
  );
}
