"use client";

import { type ReactNode, type Ref, useRef } from "react";

import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { cx } from "@/lib/cx";

import { ProfileCardPopup } from "./profile-card";
import type { RoomMemberView } from "./types";
import { StatusEmoji } from "./user-status";

/**
 * ルームのメンバー。md 以上では右のパネル、モバイルでは下から出るシートにする。
 * 同じ要素をレイアウトだけ切り替えて使い、DOM に 2 回描かない。
 */
export function MembersPanel({
  members,
  onClose,
  onOpenProfile,
  openProfileId,
  profileCard,
  onCloseProfile,
}: {
  members: RoomMemberView[];
  onClose?: () => void;
  /** 行を押した（プロフィールのカード。ADR 0050）。渡さなければ行は押せない。 */
  onOpenProfile?: (userId: string) => void;
  /** カードを開いているメンバー。カードはその行の横（パネルの左）に出す。 */
  openProfileId?: string;
  profileCard?: ReactNode;
  onCloseProfile?: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const openRow = useRef<HTMLButtonElement>(null);

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-30 bg-overlay md:hidden" onClick={onClose} />
      <aside
        ref={panel}
        aria-label="メンバー"
        className="fixed inset-x-0 bottom-0 z-40 flex max-h-3/4 flex-col rounded-t-lg bg-surface md:relative md:z-auto md:max-h-none md:pane-members md:shrink-0 md:rounded-none md:border-l md:border-border"
      >
        <ResizeHandle pane="members" grow="left" measure={panel} />
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border pr-2 pl-4">
          <h2 className="text-sm font-bold text-text">メンバー</h2>
          <IconButton label="閉じる" onClick={onClose}>
            <CloseIcon className="size-4" />
          </IconButton>
        </header>
        <ul className="min-h-0 overflow-y-auto py-2">
          {members.map((member) => (
            <li key={member.id}>
              <MemberRow
                ref={member.id === openProfileId ? openRow : undefined}
                expanded={member.id === openProfileId}
                onClick={onOpenProfile === undefined ? undefined : () => onOpenProfile(member.id)}
              >
                <Avatar id={member.id} name={member.name} imageUrl={member.avatarUrl} size="sm" presence={member.presence} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1">
                    <span className="truncate text-base font-semibold text-text">{member.name}</span>
                    {member.status && <StatusEmoji status={member.status} className="text-sm" />}
                  </p>
                  {/* ステータスの文言と「いつ消えるか」は、ここでは名前の下にそのまま読める形で出す */}
                  <p className="truncate text-2xs text-text-muted">
                    {[member.roleLabel, member.status?.text, member.status?.expiresLabel].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </MemberRow>
            </li>
          ))}
        </ul>
      </aside>
      {openProfileId !== undefined && profileCard && (
        <ProfileCardPopup anchorRef={openRow} label="プロフィール" onDismiss={onCloseProfile}>
          {profileCard}
        </ProfileCardPopup>
      )}
    </>
  );
}

/** メンバーの行。押せるときはボタンにする（押せないときに押せる見た目を出さない）。 */
function MemberRow({
  ref,
  expanded,
  onClick,
  children,
}: {
  ref?: Ref<HTMLButtonElement>;
  expanded: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className = "flex w-full items-center gap-2.5 px-4 py-2 text-left";
  if (!onClick) return <div className={className}>{children}</div>;
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className={cx(className, "cursor-pointer", expanded ? "bg-surface-muted" : "hover:bg-surface-muted")}
    >
      {children}
    </button>
  );
}
