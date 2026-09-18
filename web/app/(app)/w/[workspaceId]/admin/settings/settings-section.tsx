"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  LeaveBlockedDialog,
  LeaveWorkspaceDialog,
  TransferOwnershipConfirmDialog,
  TransferOwnershipPickDialog,
} from "@/components/workspace/member-dialogs";
import { WorkspaceSettings } from "@/components/workspace/workspace-settings";
import type { InvitePolicy } from "@/lib/api/types.gen";
import { useSessionState } from "@/lib/auth/session-provider";
import { useAvatarUrls, useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { forgetLocation } from "@/lib/chat/last-location";
import { toTransferCandidates } from "@/lib/chat/workspace-views";

/** 譲渡と退出のダイアログ。いちどに 1 つだけ開く。 */
type Overlay = { kind: "transfer-pick" | "transfer-confirm" | "leave" | "leave-blocked" } | null;

/**
 * ワークスペースの設定（名前・招待ポリシー・オーナーの譲渡・退出）。
 * 変更できるのは admin 以上で、member には読み取り専用で見せる（ADR 0006）。判定の正はサーバー。
 */
export function SettingsSection() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const store = useChatStore();
  const { state: sessionState } = useSessionState();
  const workspace = useChatState((s) => s.workspaces.list.find((w) => w.id === workspaceId));
  const members = useChatState((s) => s.members[workspaceId]);

  // 入力中だけ手元の値を使い、確定（フォーカスを外す）でサーバーに送る。送り終えたら（失敗しても）サーバーの値に戻る
  const [draftName, setDraftName] = useState<string>();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [transferTo, setTransferTo] = useState<string>();
  const [pending, setPending] = useState(false);

  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const candidates = useMemo(() => toTransferCandidates(members?.list ?? [], me?.id ?? ""), [members, me]);
  const avatarUrls = useAvatarUrls(useMemo(() => candidates.map((c) => c.id), [candidates]));

  if (!workspace || !me) return null;

  async function commitName() {
    const next = (draftName ?? "").trim();
    // 空にしたときと変わっていないときは、そのままサーバーの値に戻す
    if (!workspace || next === "" || next === workspace.name) {
      setDraftName(undefined);
      return;
    }
    try {
      await store.updateWorkspace(workspace.id, { name: next });
    } catch (err) {
      // 失敗の表示はデザインにない（docs/ui/README.md の未解決）。サーバーの値に戻す
      console.error("failed to rename workspace", err);
    } finally {
      setDraftName(undefined);
    }
  }

  async function changeInvitePolicy(invitePolicy: InvitePolicy) {
    if (!workspace || workspace.invite_policy === invitePolicy) return;
    try {
      await store.updateWorkspace(workspace.id, { invitePolicy });
    } catch (err) {
      console.error("failed to change invite policy", err);
    }
  }

  async function transfer() {
    if (!transferTo) return;
    setPending(true);
    try {
      await store.transferOwnership(workspaceId, transferTo);
      setOverlay(null);
      setTransferTo(undefined);
    } catch (err) {
      console.error("failed to transfer ownership", err);
    } finally {
      setPending(false);
    }
  }

  async function leave() {
    if (!me) return;
    setPending(true);
    try {
      await store.removeMember(workspaceId, me.id);
      forgetLocation(workspaceId);
      store.forgetRemovedWorkspace(workspaceId);
      router.replace("/");
    } catch (err) {
      // owner は譲渡するまで退出できない（409 owner-must-transfer）。ボタンを押す前に出しているので、ここには来ないはず
      console.error("failed to leave workspace", err);
      setPending(false);
    }
  }

  return (
    <>
      <WorkspaceSettings
        role={workspace.my_role}
        name={draftName ?? workspace.name}
        invitePolicy={workspace.invite_policy}
        onNameChange={setDraftName}
        onNameCommit={commitName}
        onInvitePolicyChange={changeInvitePolicy}
        onTransfer={() => setOverlay({ kind: "transfer-pick" })}
        onLeave={() => setOverlay({ kind: workspace.my_role === "owner" ? "leave-blocked" : "leave" })}
      />

      <TransferOwnershipPickDialog
        open={overlay?.kind === "transfer-pick"}
        candidates={candidates.map((c) => ({ ...c, avatarUrl: avatarUrls[c.id] ?? undefined }))}
        selectedId={transferTo}
        onSelect={setTransferTo}
        onCancel={() => setOverlay(null)}
        onNext={() => setOverlay({ kind: "transfer-confirm" })}
      />
      <TransferOwnershipConfirmDialog
        open={overlay?.kind === "transfer-confirm"}
        newOwnerName={candidates.find((c) => c.id === transferTo)?.name ?? ""}
        workspaceName={workspace.name}
        pending={pending}
        onCancel={() => setOverlay({ kind: "transfer-pick" })}
        onConfirm={transfer}
      />
      <LeaveBlockedDialog
        open={overlay?.kind === "leave-blocked"}
        onClose={() => setOverlay(null)}
        onTransfer={() => setOverlay({ kind: "transfer-pick" })}
      />
      <LeaveWorkspaceDialog
        open={overlay?.kind === "leave"}
        workspaceName={workspace.name}
        pending={pending}
        onCancel={() => setOverlay(null)}
        onConfirm={leave}
      />
    </>
  );
}
