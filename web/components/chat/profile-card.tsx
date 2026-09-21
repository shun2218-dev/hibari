"use client";

import type { ReactNode, RefObject } from "react";

import { AnchoredPanel } from "@/components/ui/anchored-panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckIcon, MailIcon, MoreIcon } from "@/components/ui/icons";
import { Popover } from "@/components/ui/popover";
import { Portal } from "@/components/ui/portal";
import { roleLabel, type WorkspaceRole } from "@/components/workspace/types";
import { cx } from "@/lib/cx";
import { presenceLabel } from "@/lib/presence";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";

import type { ProfileCardView } from "./types";

// 管理画面のメンバー一覧と同じ色分け（オーナーはワークスペースにひとりだけの特別な状態なので琥珀）
const roleTone: Record<WorkspaceRole, BadgeTone> = { owner: "attention", admin: "primary", member: "neutral" };

type ProfileCardProps = {
  profile: ProfileCardView;
  /** 3 点メニューを開いているか。 */
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  /** 「DM を送る」を押して、応答を待っている（二重に押させない。決定 4）。 */
  dmPending?: boolean;
  onSendDm?: () => void;
  onEditProfile?: () => void;
  onCopyHandle?: () => void;
  onCopyEmail?: () => void;
  onChangeRole?: (role: WorkspaceRole) => void;
  onRemove?: () => void;
};

/**
 * プロフィールのカードの中身（ADR 0050）。置き場所（浮かせる / 下から出す）は `ProfileCardPopup` が決める。
 *
 * 表示するものはオーナーと確定したもの（アバター・表示名・`@handle`・email・ロール・presence）に、
 * Phase 6.8 のカスタムステータスを足したものだけ。最終オンライン時刻は出さない（ADR 0049）。
 */
export function ProfileCard({
  profile,
  menuOpen = false,
  onToggleMenu,
  dmPending = false,
  onSendDm,
  onEditProfile,
  onCopyHandle,
  onCopyEmail,
  onChangeRole,
  onRemove,
}: ProfileCardProps) {
  const { user } = profile;
  const member = profile.kind === "member" ? profile : undefined;
  const status = member ? user.status : undefined;

  return (
    <div className="flex flex-col">
      <div className="flex gap-3 p-4">
        {/* 外された人の presence は出さない（一覧にいないので分からない。決定 5） */}
        <Avatar id={user.id} name={user.name} imageUrl={user.avatarUrl} size="xl" presence={member?.presence} className="self-start" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-1.5">
            <span className="truncate text-xl font-bold text-text">{user.name}</span>
            {status && (
              <span role="img" aria-hidden className="shrink-0 text-lg leading-none">
                {status.emoji}
              </span>
            )}
          </p>
          <p className="truncate font-mono text-xs text-text-muted">@{user.handle}</p>
          {member ? (
            <p className="flex items-center gap-2">
              <Badge tone={roleTone[member.role]}>{roleLabel[member.role]}</Badge>
              {member.presence !== "offline" && (
                <span className="text-xs text-text-secondary">{presenceLabel[member.presence]}</span>
              )}
            </p>
          ) : (
            <p className="text-xs text-text-muted">このワークスペースのメンバーではありません</p>
          )}
        </div>
      </div>

      {/* 名前の横には絵文字だけを出し、文言と期限はここでそのまま読めるようにする（ADR 0049 決定 10） */}
      {status && (status.text || status.expiresLabel) && (
        <p className="mx-4 mb-3 flex gap-2 rounded-sm bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          <span role="img" aria-hidden className="leading-relaxed">
            {status.emoji}
          </span>
          <span className="min-w-0 leading-relaxed">
            {status.text && <span className="text-text">{status.text}</span>}
            {status.text && status.expiresLabel && " · "}
            {status.expiresLabel}
          </span>
        </p>
      )}

      {member && member.email.state !== "none" && (
        <div className="flex h-11 items-center gap-2 border-t border-border px-4">
          <MailIcon className="size-4 shrink-0 text-text-muted" />
          {member.email.state === "ready" ? (
            <span className="truncate text-sm text-text">{member.email.value}</span>
          ) : (
            // 応答を待つ間は、行の高さを取ったまま薄い帯を出す（開いた直後にカードの高さが揺れない。決定 1）
            <span role="status" aria-label="メールアドレスを読み込み中" className="h-4 w-44 rounded-sm bg-surface-muted" />
          )}
        </div>
      )}

      <div className="relative flex gap-2 border-t border-border p-3">
        {!member ? (
          <Button variant="secondary" className="flex-1" onClick={onCopyHandle}>
            ハンドルをコピー
          </Button>
        ) : (
          <>
            {member.isSelf ? (
              <Button variant="secondary" className="flex-1" onClick={onEditProfile}>
                プロフィールを編集
              </Button>
            ) : (
              <Button className="flex-1" onClick={onSendDm} disabled={dmPending}>
                DM を送る
              </Button>
            )}
            {/* Button の secondary と同じ枠と高さの正方形。Button の横の余白（px-4）は後から打ち消せないので、別に書く */}
            <button
              type="button"
              aria-label="その他の操作"
              aria-expanded={menuOpen}
              onClick={onToggleMenu}
              className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-text-secondary hover:bg-surface-muted"
            >
              <MoreIcon className="size-4" />
            </button>
            {menuOpen && (
              // カードの下端は画面の下に寄せられていることがあるので、メニューは上に開く
              <Popover label="その他の操作" className="right-3 bottom-full w-58">
                <MenuItem onClick={onCopyHandle}>ハンドルをコピー</MenuItem>
                {member.email.state === "ready" && <MenuItem onClick={onCopyEmail}>メールアドレスをコピー</MenuItem>}
                {member.manage && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <p className="px-2.5 pt-1.5 pb-1 text-2xs text-text-muted">ロールの変更</p>
                    <ul>
                      {member.manage.grantableRoles.map((role) => {
                        const current = role === member.role;
                        return (
                          <li key={role}>
                            <button
                              type="button"
                              aria-pressed={current}
                              onClick={() => onChangeRole?.(role)}
                              className={cx(
                                "flex h-9.5 w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 text-left text-base text-text",
                                current ? "bg-primary-subtle font-semibold" : "hover:bg-surface-muted",
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
                    {member.manage.canRemove && (
                      <>
                        <div className="my-1 h-px bg-border" />
                        <MenuItem onClick={onRemove} danger>
                          ワークスペースから削除
                        </MenuItem>
                      </>
                    )}
                  </>
                )}
              </Popover>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MenuItem({ children, onClick, danger = false }: { children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex h-9.5 w-full cursor-pointer items-center rounded-sm px-2.5 text-left text-base hover:bg-surface-muted",
        danger ? "font-medium text-danger" : "text-text",
      )}
    >
      {children}
    </button>
  );
}

/**
 * カードの置き場所（ADR 0050 決定 6）。md 以上は押したアバターや名前の横に浮かせ、モバイルは下から出るシートにする
 * （リアクションのピッカーと同じ出し方。ADR 0049 決定 10 の追記）。置き方が違うのでクラスでは書き分けられない。
 */
export function ProfileCardPopup({
  anchorRef,
  label,
  onDismiss,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  /** 読み上げの名前（「佐藤 直樹 のプロフィール」）。 */
  label: string;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (desktop) {
    return (
      <AnchoredPanel
        anchorRef={anchorRef}
        label={label}
        onDismiss={onDismiss}
        beside
        className="w-80 rounded-md border border-border bg-surface shadow-overlay"
      >
        {children}
      </AnchoredPanel>
    );
  }
  return (
    <Portal>
      <div aria-hidden className="fixed inset-0 z-40 bg-overlay" onClick={onDismiss} />
      <div role="dialog" aria-label={label} className="fixed inset-x-0 bottom-0 z-50 rounded-t-lg bg-surface pb-2">
        {children}
      </div>
    </Portal>
  );
}
