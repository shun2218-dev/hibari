import type { ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/choice";
import { TextField } from "@/components/ui/field";

import type { InvitePolicy, WorkspaceRole } from "./types";

type WorkspaceSettingsProps = {
  role: WorkspaceRole;
  name: string;
  invitePolicy: InvitePolicy;
  onNameChange?: (name: string) => void;
  /** 名前の変更を確定する（フォーカスを外したとき）。 */
  onNameCommit?: () => void;
  onInvitePolicyChange?: (policy: InvitePolicy) => void;
  onTransfer?: () => void;
  onLeave?: () => void;
};

/**
 * 名前と招待ポリシーを変えられるのは admin 以上（ADR 0006）。member には読み取り専用で見せ、理由を上に出す。
 */
export function WorkspaceSettings({
  role,
  name,
  invitePolicy,
  onNameChange,
  onNameCommit,
  onInvitePolicyChange,
  onTransfer,
  onLeave,
}: WorkspaceSettingsProps) {
  const canEdit = role !== "member";

  return (
    <div className="flex flex-col">
      {!canEdit && (
        <Alert tone="locked" className="mb-5 text-sm">
          ワークスペースの設定を変更できるのは管理者とオーナーだけです。
        </Alert>
      )}

      <div className="max-w-100 pb-6">
        <TextField
          label="ワークスペース名"
          value={name}
          onChange={(e) => onNameChange?.(e.target.value)}
          onBlur={onNameCommit}
          disabled={!canEdit}
          hint="すべてのメンバーに表示されます。"
        />
      </div>

      <Section title="招待リンクを作成できる人" description="管理者とオーナーは常に作成できます。">
        <div className="flex max-w-100 flex-col gap-2" role="radiogroup" aria-label="招待リンクを作成できる人">
          <RadioCard
            name="invite-policy"
            value="admins_only"
            checked={invitePolicy === "admins_only"}
            onChange={() => onInvitePolicyChange?.("admins_only")}
            disabled={!canEdit}
            title="管理者のみ"
            description="オーナーと管理者だけが招待リンクを作成できます"
          />
          <RadioCard
            name="invite-policy"
            value="all_members"
            checked={invitePolicy === "all_members"}
            onChange={() => onInvitePolicyChange?.("all_members")}
            disabled={!canEdit}
            title="全メンバー"
            description="メンバーも招待リンクを作成できます"
          />
        </div>
      </Section>

      {role === "owner" && (
        <Section
          title="オーナーの譲渡"
          description="オーナーはワークスペースにひとりだけです。譲渡すると、あなたは管理者になります。"
        >
          <Button variant="secondary" onClick={onTransfer} className="self-start">
            オーナーを譲渡
          </Button>
        </Section>
      )}

      <Section
        title="ワークスペースを退出"
        description={
          role === "owner"
            ? "あなたはオーナーです。退出するには、先に他のメンバーにオーナーを譲渡してください。"
            : "参加中のチャンネルからも外れます。再び参加するには招待リンクが必要です。"
        }
      >
        {/* オーナーでもボタン自体は押せる。押すと「先に譲渡してください」を出して、譲渡に進めるようにする */}
        <Button
          variant={role === "owner" ? "secondary" : "danger-outline"}
          onClick={onLeave}
          className={role === "owner" ? "self-start text-text-muted" : "self-start"}
        >
          退出する
        </Button>
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 border-t border-border py-6">
      <h2 className="text-sm font-bold text-text">{title}</h2>
      <p className="pb-3 text-sm text-text-secondary">{description}</p>
      {children}
    </section>
  );
}
