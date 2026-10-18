import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, TextButton } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice";
import { Dialog } from "@/components/ui/dialog";
import { cx } from "@/lib/cx";

import type { InviteRowView, InviteStatus } from "./types";

const statusBadge: Record<InviteStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "有効", tone: "primary" },
  exhausted: { label: "上限到達", tone: "neutral" },
  expired: { label: "期限切れ", tone: "neutral" },
  revoked: { label: "取り消し済み", tone: "danger" },
};

// 招待コードの生値はサーバーに残らないので、一覧では常に伏せ字にする（作成直後にだけ表示する）
const maskedInviteUrl = "hibari.app/j/•••••••";

type InviteListProps = {
  invites: InviteRowView[];
  /** 自分が招待リンクを作成できるか。できない理由は createLockedReason に入れる。 */
  canCreate: boolean;
  createLockedReason?: string;
  onCreate?: () => void;
  onRevoke?: (inviteId: string) => void;
};

export function InviteList({ invites, canCreate, createLockedReason, onCreate, onRevoke }: InviteListProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-5">
        <div className="flex flex-1 flex-col gap-3">
          <p className="text-sm leading-relaxed text-text-secondary">
            リンクを知っている人はワークスペースに参加できます。使い終わったリンクは取り消してください。
          </p>
          {!canCreate && createLockedReason && (
            <Alert tone="locked" className="text-sm">
              {createLockedReason}
            </Alert>
          )}
        </div>
        <Button onClick={onCreate} disabled={!canCreate}>
          招待リンクを作成
        </Button>
      </div>

      <ul className="rounded-md border border-border">
        {invites.map((invite, index) => {
          const badge = statusBadge[invite.status];
          return (
            <li
              key={invite.id}
              className={cx("flex items-center gap-3 px-3.5 py-3.5", index > 0 && "border-t border-border")}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="font-mono text-sm text-text-secondary">{maskedInviteUrl}</span>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </p>
                <p className="text-xs text-text-muted">
                  {invite.createdByName} が作成 · {invite.usesLabel} · {invite.expiryLabel}
                </p>
              </div>
              {invite.canRevoke && invite.status === "active" && (
                <TextButton tone="danger" onClick={() => onRevoke?.(invite.id)} className="text-sm font-semibold">
                  取り消す
                </TextButton>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-2xs text-text-muted">リンクは作成直後に一度だけ表示されます。あとから再表示することはできません。</p>
    </div>
  );
}

/** 使用回数の選択肢。null は無制限。 */
export const inviteMaxUsesOptions = [null, 1, 5, 10, 25, 100] as const;
/** 有効期限の選択肢（秒）。 */
export const inviteExpiryOptions = [
  { seconds: 30 * 60, label: "30 分" },
  { seconds: 60 * 60, label: "1時間" },
  { seconds: 24 * 60 * 60, label: "1日" },
  { seconds: 7 * 24 * 60 * 60, label: "7日" },
] as const;

export type InviteMaxUses = (typeof inviteMaxUsesOptions)[number];

export function CreateInviteDialog({
  open,
  maxUses,
  expiresInSeconds,
  onMaxUsesChange,
  onExpiryChange,
  creating,
  onCancel,
  onCreate,
}: {
  open: boolean;
  maxUses: InviteMaxUses;
  expiresInSeconds: number;
  onMaxUsesChange?: (value: InviteMaxUses) => void;
  onExpiryChange?: (seconds: number) => void;
  creating?: boolean;
  onCancel?: () => void;
  onCreate?: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="wide"
      title="招待リンクを作成"
      description="使用回数と有効期限を決めてください。リンクは作成直後に一度だけ表示されます。"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onCreate} disabled={creating}>
            作成する
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-xs font-medium text-text">使用回数</legend>
        <div className="flex flex-wrap gap-2">
          {inviteMaxUsesOptions.map((value) => (
            <ChoiceChip
              key={value ?? "unlimited"}
              name="max-uses"
              value={String(value)}
              checked={value === maxUses}
              onChange={() => onMaxUsesChange?.(value)}
            >
              {value === null ? "無制限" : `${value} 回`}
            </ChoiceChip>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-xs font-medium text-text">有効期限</legend>
        <div className="flex flex-wrap gap-2">
          {inviteExpiryOptions.map((option) => (
            <ChoiceChip
              key={option.seconds}
              name="expiry"
              value={String(option.seconds)}
              checked={option.seconds === expiresInSeconds}
              onChange={() => onExpiryChange?.(option.seconds)}
            >
              {option.label}
            </ChoiceChip>
          ))}
        </div>
      </fieldset>
    </Dialog>
  );
}

/**
 * 作成直後の 1 度だけ招待リンクを見せる。コードの生値はサーバーに残らないので、閉じたら二度と表示できない。
 */
export function InviteCreatedDialog({
  open,
  url,
  summary,
  onCopy,
  onClose,
}: {
  open: boolean;
  url: string;
  /** 「10 回 · 7 日後に失効 · 山と印刷」 */
  summary: string;
  onCopy?: () => void;
  onClose?: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="wide"
      title="リンクを作成しました"
      description="このリンクを渡した人がワークスペースに参加できます。"
      actions={<Button onClick={onClose}>閉じる</Button>}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted py-2 pr-2 pl-3">
          {/* 招待コードは 22 文字あるので、狭い幅では折り返さずに横へ流す（docs/ui/README.md の未解決） */}
          <output className="min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap text-text">{url}</output>
          <Button size="sm" onClick={onCopy}>
            コピー
          </Button>
        </div>
        <Alert tone="attention">この画面を閉じると再表示できません。いま控えておいてください。</Alert>
        <p className="text-xs text-text-muted">{summary}</p>
      </div>
    </Dialog>
  );
}
