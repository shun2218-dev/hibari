"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  CreateInviteDialog,
  InviteCreatedDialog,
  type InviteMaxUses,
  inviteExpiryOptions,
} from "@/components/workspace/invites";
import { InviteList } from "@/components/workspace/invites";
import { useSessionState } from "@/lib/auth/session-provider";
import { useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { canCreateInvite, inviteUrl, toInviteRowView } from "@/lib/chat/workspace-views";

/** 作成のダイアログの既定。デザイン（workspace/dialog-invite-new.png）と同じ 10 回・7 日。 */
const DEFAULT_MAX_USES: InviteMaxUses = 10;
const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

/**
 * 招待リンクの一覧と作成・取り消し。
 *
 * コードの生値はサーバーに残らない（ハッシュだけを保存する。ADR 0006）ので、作成の応答でしか表示できない。
 * 閉じたら手元からも捨て、一覧には出さない。
 */
export function InvitesSection() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const store = useChatStore();
  const { state: sessionState } = useSessionState();
  const workspace = useChatState((s) => s.workspaces.list.find((w) => w.id === workspaceId));
  const invites = useChatState((s) => s.invites[workspaceId]);

  const [creating, setCreating] = useState(false);
  const [maxUses, setMaxUses] = useState<InviteMaxUses>(DEFAULT_MAX_USES);
  const [expiresInSeconds, setExpiresInSeconds] = useState<number>(DEFAULT_EXPIRY_SECONDS);
  const [pending, setPending] = useState(false);
  /** 作成できたリンク。閉じるまでの 1 度だけ出す。 */
  const [created, setCreated] = useState<{ url: string; summary: string }>();

  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const list = useMemo(() => invites?.list ?? [], [invites]);
  const myRole = workspace?.my_role;
  const policy = workspace?.invite_policy;
  const views = useMemo(
    () =>
      me && myRole && policy
        ? list.map((invite) => toInviteRowView(invite, { userId: me.id, myRole, invitePolicy: policy }))
        : [],
    [list, me, myRole, policy],
  );

  if (!workspace || !me) return null;

  async function create() {
    if (!workspace) return;
    setPending(true);
    try {
      const invite = await store.createInvite(workspaceId, { maxUses, expiresInSeconds });
      const expiryLabel = inviteExpiryOptions.find((o) => o.seconds === expiresInSeconds)?.label ?? "";
      setCreating(false);
      setCreated({
        url: inviteUrl(window.location.origin, invite.code ?? ""),
        summary: `${maxUses === null ? "無制限" : `${maxUses} 回`} · ${expiryLabel}後に失効 · ${workspace.name}`,
      });
      setMaxUses(DEFAULT_MAX_USES);
      setExpiresInSeconds(DEFAULT_EXPIRY_SECONDS);
    } catch (err) {
      // 失敗の表示はデザインにない（docs/ui/README.md の未解決）。ダイアログを残して押し直せるようにする
      console.error("failed to create invite", err);
    } finally {
      setPending(false);
    }
  }

  async function revoke(inviteId: string) {
    try {
      await store.revokeInvite(workspaceId, inviteId);
    } catch (err) {
      console.error("failed to revoke invite", err);
    }
  }

  const canCreate = canCreateInvite(workspace.my_role, workspace.invite_policy);

  return (
    <>
      <InviteList
        invites={views}
        canCreate={canCreate}
        createLockedReason={canCreate ? undefined : "管理者だけが招待リンクを作成できます。"}
        onCreate={() => setCreating(true)}
        onRevoke={revoke}
      />
      <CreateInviteDialog
        open={creating}
        maxUses={maxUses}
        expiresInSeconds={expiresInSeconds}
        onMaxUsesChange={setMaxUses}
        onExpiryChange={setExpiresInSeconds}
        creating={pending}
        onCancel={() => setCreating(false)}
        onCreate={create}
      />
      <InviteCreatedDialog
        open={created !== undefined}
        url={created?.url ?? ""}
        summary={created?.summary ?? ""}
        onCopy={() => {
          // コピーできなかったときの表示はデザインにない。URL は画面に出ているので、手で選んで写せる
          void navigator.clipboard?.writeText(created?.url ?? "").catch((err) => {
            console.error("failed to copy the invite url", err);
          });
        }}
        onClose={() => setCreated(undefined)}
      />
    </>
  );
}
