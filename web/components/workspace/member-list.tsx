import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { IconButton, TextButton } from "@/components/ui/button";
import { CheckIcon, LockIcon, MoreIcon } from "@/components/ui/icons";
import { Popover } from "@/components/ui/popover";
import { cx } from "@/lib/cx";

import { roleLabel, type MemberRowView, type WorkspaceRole } from "./types";

// オーナーはワークスペースにひとりだけの特別な状態なので琥珀、管理者は primary、メンバーは地味にする
const roleTone: Record<WorkspaceRole, BadgeTone> = {
  owner: "attention",
  admin: "primary",
  member: "neutral",
};

/** 開いているポップオーバー。行ごとに 1 つだけ開く。 */
export type MemberMenuState = { userId: string; kind: "roles" | "locked" } | null;

type MemberListProps = {
  members: MemberRowView[];
  openMenu?: MemberMenuState;
  onOpenMenu?: (menu: NonNullable<MemberMenuState>) => void;
  onCloseMenu?: () => void;
  onChangeRole?: (userId: string, role: WorkspaceRole) => void;
  /** キックの確認ダイアログを開く。 */
  onRemove?: (userId: string) => void;
};

export function MemberList({ members, openMenu = null, onOpenMenu, onCloseMenu, onChangeRole, onRemove }: MemberListProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm text-text-secondary">{members.length}人のメンバー</h2>
        <span className="font-mono text-2xs text-text-muted">owner · admin · member</span>
      </div>
      <ul className="rounded-md border border-border">
        {members.map((member, index) => {
          const menu = openMenu?.userId === member.id ? openMenu.kind : null;
          return (
            <li
              key={member.id}
              className={cx("relative flex items-center gap-3 px-3.5 py-3", index > 0 && "border-t border-border")}
            >
              <Avatar id={member.id} name={member.name} imageUrl={member.avatarUrl} size="md" online={member.online} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate text-base font-semibold text-text">{member.name}</span>
                  {member.isSelf && <Badge tone="primary">あなた</Badge>}
                </p>
                <p className="font-mono text-2xs text-text-muted">
                  @{member.handle}
                  <span className="ml-2">{member.online ? "オンライン" : "オフライン"}</span>
                </p>
              </div>
              <Badge tone={roleTone[member.role]}>{roleLabel[member.role]}</Badge>

              {member.manage.kind === "menu" ? (
                <IconButton
                  label={`${member.name} のロールを変更`}
                  aria-expanded={menu === "roles"}
                  onClick={() => (menu ? onCloseMenu?.() : onOpenMenu?.({ userId: member.id, kind: "roles" }))}
                >
                  <MoreIcon className="size-4" />
                </IconButton>
              ) : (
                <IconButton
                  label={`${member.name} を管理できない理由`}
                  aria-expanded={menu === "locked"}
                  onClick={() => (menu ? onCloseMenu?.() : onOpenMenu?.({ userId: member.id, kind: "locked" }))}
                  muted
                >
                  <LockIcon className="size-3.5" />
                </IconButton>
              )}

              {menu === "roles" && member.manage.kind === "menu" && (
                <Popover label="付与できるロール" className="top-13 right-3 w-58">
                  <p className="px-2.5 pt-1.5 pb-1 text-2xs text-text-muted">付与できるロール</p>
                  <ul>
                    {member.manage.grantableRoles.map((role) => {
                      const current = role === member.role;
                      return (
                        <li key={role}>
                          <button
                            type="button"
                            aria-pressed={current}
                            onClick={() => onChangeRole?.(member.id, role)}
                            className={cx(
                              "flex h-9.5 w-full items-center gap-2 rounded-sm px-2.5 text-left text-base font-semibold text-text",
                              current ? "bg-primary-subtle" : "hover:bg-surface-muted",
                            )}
                          >
                            <span className="flex w-4 justify-center text-primary">
                              {current && <CheckIcon className="size-3.5" />}
                            </span>
                            {roleLabel[role]}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="px-2.5 pt-2 pb-1.5 text-2xs text-text-muted">オーナーは譲渡でのみ移ります。</p>
                  {member.manage.canRemove && (
                    <>
                      <div className="my-1 h-px bg-border" />
                      <button
                        type="button"
                        onClick={() => onRemove?.(member.id)}
                        className="flex h-9.5 w-full items-center rounded-sm px-2.5 text-left text-base font-medium text-danger hover:bg-surface-muted"
                      >
                        ワークスペースから削除
                      </button>
                    </>
                  )}
                </Popover>
              )}

              {menu === "locked" && member.manage.kind === "locked" && (
                <Popover label="管理できない理由" className="top-13 right-3 w-62 p-3.5">
                  <p className="text-sm leading-relaxed text-text-secondary">{member.manage.reason}</p>
                  <TextButton onClick={onCloseMenu} className="mt-2 text-sm font-semibold">
                    閉じる
                  </TextButton>
                </Popover>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
