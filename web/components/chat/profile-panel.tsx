"use client";

import { useRef } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { CheckIcon, ChevronLeftIcon, CloseIcon, CopyIcon, MailIcon, MoreIcon, UserMinusIcon } from "@/components/ui/icons";
import { MenuItem } from "@/components/ui/menu-item";
import { Popover } from "@/components/ui/popover";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { roleLabel, type WorkspaceRole } from "@/components/workspace/types";
import { cx } from "@/lib/cx";

import { ProfileSummary } from "./profile-card";
import type { ProfileView } from "./types";

type ProfilePanelProps = {
  profile: ProfileView;
  /** 閉じる（md 以上は ×、モバイルは左上の戻る）。 */
  onClose?: () => void;
  /**
   * メンバーパネルから開いたときだけ渡す。左上に「メンバーに戻る」を出し、右の枠をメンバーの一覧に戻す
   * （続けて何人も見るときに、毎回メンバーを開き直さずに済む。ADR 0050 決定 6 の追記）。
   */
  onBack?: () => void;
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
 * プロフィールのパネル（ADR 0050 決定 6 の追記）。アバターや名前を押すと開く。
 * md 以上ではスレッドと同じ右の枠（幅も `--pane-thread` を共有する）、モバイルではルームの上に重なる全画面にする。
 * 同じ要素をレイアウトだけ切り替えて使い、DOM に 2 回描かない（ThreadPanel と同じ形）。
 *
 * email・コピー・ロールの変更・削除はここにだけ置く（ホバーのカードは要約と「DM を送る」だけ）。
 */
export function ProfilePanel({
  profile,
  onClose,
  onBack,
  menuOpen = false,
  onToggleMenu,
  dmPending = false,
  onSendDm,
  onEditProfile,
  onCopyHandle,
  onCopyEmail,
  onChangeRole,
  onRemove,
}: ProfilePanelProps) {
  const panel = useRef<HTMLElement>(null);
  const member = profile.kind === "member" ? profile : undefined;

  return (
    <aside
      ref={panel}
      aria-label="プロフィール"
      className="fixed inset-0 z-40 flex flex-col bg-surface md:relative md:z-auto md:pane-thread md:shrink-0 md:border-l md:border-border"
    >
      <ResizeHandle pane="thread" grow="left" measure={panel} />
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 md:pr-2 md:pl-4">
        {onBack ? (
          <IconButton label="メンバーに戻る" onClick={onBack}>
            <ChevronLeftIcon className="size-5" />
          </IconButton>
        ) : (
          <IconButton label="戻る" onClick={onClose} className="md:hidden">
            <ChevronLeftIcon className="size-5" />
          </IconButton>
        )}
        <h2 className="min-w-0 flex-1 pl-1 text-sm font-bold text-text md:pl-0">プロフィール</h2>
        <IconButton label="プロフィールを閉じる" onClick={onClose} className="max-md:hidden">
          <CloseIcon className="size-4" />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {profile.kind === "unknown" ? (
          <p className="p-5 text-sm leading-relaxed text-text-muted">このワークスペースのメンバーではありません。</p>
        ) : (
          <>
            <div className="p-5">
              <ProfileSummary profile={profile} layout="panel" />
            </div>

            <div className="relative flex gap-2 px-5 pb-5">
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
                  {menuOpen && <ProfileMenu profile={member} onDismiss={onToggleMenu} {...{ onCopyHandle, onCopyEmail, onChangeRole, onRemove }} />}
                </>
              )}
            </div>

            {member && member.email.state !== "none" && (
              <section aria-label="連絡先" className="border-t border-border px-5 py-4">
                <h3 className="text-xs font-semibold text-text-muted">連絡先</h3>
                <div className="mt-2 flex h-6 items-center gap-2">
                  <MailIcon className="size-4 shrink-0 text-text-muted" />
                  {member.email.state === "ready" ? (
                    <span className="truncate font-mono text-sm text-text">{member.email.value}</span>
                  ) : (
                    // 応答を待つ間は、行の高さを取ったまま薄い帯を出す（開いた直後に並びが揺れない。決定 1）
                    <span role="status" aria-label="メールアドレスを読み込み中" className="h-4 w-44 rounded-sm bg-surface-muted" />
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function ProfileMenu({
  profile,
  onCopyHandle,
  onCopyEmail,
  onChangeRole,
  onRemove,
  onDismiss,
}: {
  profile: Extract<ProfileView, { kind: "member" }>;
  /** 外を押す・Esc で閉じる。 */
  onDismiss?: () => void;
  onCopyHandle?: () => void;
  onCopyEmail?: () => void;
  onChangeRole?: (role: WorkspaceRole) => void;
  onRemove?: () => void;
}) {
  return (
    // 操作の行は大きな写真の下にあり、下に開くと画面の下で切れる。上（写真の側）に開く
    <Popover label="その他の操作" className="right-5 bottom-full w-58" onDismiss={onDismiss}>
      <MenuItem icon={CopyIcon} onClick={onCopyHandle}>
        ハンドルをコピー
      </MenuItem>
      {profile.email.state === "ready" && (
        <MenuItem icon={MailIcon} onClick={onCopyEmail}>
          メールアドレスをコピー
        </MenuItem>
      )}
      {profile.manage && (
        <>
          <div className="my-1 h-px bg-border" />
          <p className="px-2.5 pt-1.5 pb-1 text-2xs text-text-muted">ロールの変更</p>
          <ul>
            {profile.manage.grantableRoles.map((role) => {
              const current = role === profile.role;
              return (
                <li key={role}>
                  <button
                    type="button"
                    aria-pressed={current}
                    onClick={() => onChangeRole?.(role)}
                    className={cx(
                      "flex h-9.5 w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-left text-base text-text",
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
          {profile.manage.canRemove && (
            <>
              <div className="my-1 h-px bg-border" />
              <MenuItem icon={UserMinusIcon} onClick={onRemove} danger>
                ワークスペースから削除
              </MenuItem>
            </>
          )}
        </>
      )}
    </Popover>
  );
}
