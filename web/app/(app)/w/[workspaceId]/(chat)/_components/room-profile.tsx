"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ProfilePanel } from "@/components/chat/profile-panel";
import { KickMemberDialog } from "@/components/workspace/member-dialogs";
import type { WorkspaceRole } from "@/components/workspace/types";
import { useSessionState } from "@/hooks/auth/use-session";
import { useChatState, useChatStore } from "@/hooks/chat/use-chat-store";
import { useAvatarUrls } from "@/hooks/chat/use-media";
import { useOpenDm } from "@/hooks/chat/use-open-dm";
import type { ProfileSender } from "@/hooks/chat/use-senders";
import { ApiError } from "@/lib/api/error";
import { type ProfileEmail, toProfileView } from "@/lib/chat/views/workspace-views";

/**
 * 右のプロフィールのパネル（ADR 0050 決定 6 の追記）。URL の `?p=<userID>` で開く。
 *
 * 名前・ロール・presence・ステータスは手元のメンバー一覧から（ロールの変更やキックもイベントで追従する）。
 * email だけは開くたびに 1 人分の API から取り、ストアに入れない（決定 1）。
 */
export function RoomProfile({
  workspaceId,
  userId,
  fallback,
  onClose,
  onBack,
}: {
  workspaceId: string;
  userId: string;
  /** メッセージから開いたときの送信者の値。一覧にいない人（外された人）の名前に使う。 */
  fallback?: ProfileSender;
  onClose: () => void;
  /** メンバーパネルから開いたときだけ。「メンバーに戻る」を出す。 */
  onBack?: () => void;
}) {
  const router = useRouter();
  const store = useChatStore();
  const { state: sessionState } = useSessionState();
  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const members = useChatState((s) => s.members[workspaceId]);
  const myRole = useChatState((s) => s.workspaces.list.find((w) => w.id === workspaceId)?.my_role);
  const avatarUrls = useAvatarUrls(useMemo(() => [userId], [userId]));
  const member = members?.list.find((m) => m.user.id === userId);

  const [email, setEmail] = useState<{ userId: string; value: ProfileEmail }>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [kicking, setKicking] = useState(false);
  const [kickPending, setKickPending] = useState(false);
  const dm = useOpenDm(workspaceId, onClose);

  // 一覧にいる人だけ email を取る。いない人は API も 404 なので呼ばない（決定 5）
  const isMember = member !== undefined;
  useEffect(() => {
    if (!isMember) return;
    let cancelled = false;
    store.getMemberEmail(workspaceId, userId).then(
      (value) => {
        if (!cancelled) setEmail({ userId, value: value === null ? { state: "none" } : { state: "ready", value } });
      },
      (err: unknown) => {
        // 外された直後などの 404 は「出さない」と同じ。ほかの失敗も、パネルの残りは見せたまま email だけを諦める
        if (!(err instanceof ApiError && err.status === 404)) console.error("failed to load the member profile", err);
        if (!cancelled) setEmail({ userId, value: { state: "none" } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, workspaceId, userId, isMember]);

  const profile = toProfileView(member, {
    userId: me?.id ?? "",
    myRole,
    email: email?.userId === userId ? email.value : { state: "loading" },
    fallback,
    avatarUrls,
  });

  async function copy(text: string) {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // コピーできなかったときの表示はデザインにない（ADR 0029 の招待リンクと同じ）
      console.error("failed to copy", err);
    }
  }

  async function changeRole(role: WorkspaceRole) {
    setMenuOpen(false);
    try {
      await store.changeMemberRole(workspaceId, userId, role);
    } catch (err) {
      // 失敗の表示はデザインにない（管理画面と同じ）。一覧はサーバーの値のままにする
      console.error("failed to change member role", err);
    }
  }

  async function kick() {
    setKickPending(true);
    try {
      await store.removeMember(workspaceId, userId);
      setKicking(false);
    } catch (err) {
      console.error("failed to remove member", err);
    } finally {
      setKickPending(false);
    }
  }

  const handle = profile.kind === "unknown" ? undefined : profile.user.handle;
  return (
    <>
      <ProfilePanel
        profile={profile}
        onClose={onClose}
        onBack={onBack}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        dmPending={dm.pending}
        onSendDm={() => void dm.open(userId)}
        onEditProfile={() => router.push("/settings/profile")}
        onCopyHandle={() => handle && void copy(`@${handle}`)}
        onCopyEmail={() => profile.kind === "member" && profile.email.state === "ready" && void copy(profile.email.value)}
        onChangeRole={(role) => void changeRole(role)}
        onRemove={() => {
          setMenuOpen(false);
          setKicking(true);
        }}
      />
      <KickMemberDialog
        open={kicking}
        memberName={profile.kind === "unknown" ? "" : profile.user.name}
        pending={kickPending}
        onCancel={() => setKicking(false)}
        onConfirm={() => void kick()}
      />
    </>
  );
}
