"use client";

import { type ReactNode, useCallback } from "react";

import { ProfileHoverCard } from "@/components/chat/profile-card";
import { useSessionState } from "@/hooks/auth/use-session";
import { toProfileView } from "@/lib/chat/views/workspace-views";

import { useChatState } from "./use-chat-store";
import { useMediaState } from "./use-media";
import { useOpenDm } from "./use-open-dm";
import type { ProfileSender } from "./use-senders";

/**
 * タイムラインのアバターや名前に乗せたときのカード（ADR 0050 決定 6 の追記）。
 * 中身は手元のメンバー一覧だけで作る。ホバーでは API を呼ばない（email はパネルにだけ出す）。
 */
export function useProfileHoverCard({
  workspaceId,
  senderOf,
}: {
  workspaceId: string;
  senderOf: (userId: string) => ProfileSender | undefined;
}): (userId: string) => ReactNode {
  const { state: sessionState } = useSessionState();
  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const members = useChatState((s) => s.members[workspaceId]);
  const myRole = useChatState((s) => s.workspaces.list.find((w) => w.id === workspaceId)?.my_role);
  // タイムラインが送信者のアバターを取ってあるので、ここでは頼み直さずに表だけ読む
  const avatarUrls = useMediaState((s) => s.avatars);
  const dm = useOpenDm(workspaceId);

  return useCallback(
    (userId: string) => {
      const member = members?.list.find((m) => m.user.id === userId);
      const profile = toProfileView(member, { userId: me?.id ?? "", myRole, fallback: senderOf(userId), avatarUrls });
      // 手がかりのない人はカードを出さない（押せばパネルが「メンバーではありません」を出す）
      if (profile.kind === "unknown") return null;
      return <ProfileHoverCard profile={profile} dmPending={dm.pending} onSendDm={() => void dm.open(userId)} />;
    },
    [members, me, myRole, senderOf, avatarUrls, dm],
  );
}
