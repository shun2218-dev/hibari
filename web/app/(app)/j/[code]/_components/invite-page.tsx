"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { InviteAccept, type InviteAcceptState, type InvitePreviewView } from "@/components/invite/invite-accept";
import { useSession } from "@/hooks/auth/use-session";
import { useChatStore } from "@/hooks/chat/use-chat-store";
import { ApiError } from "@/lib/api/error";
import type { InvitePreview } from "@/lib/api/types.gen";

/**
 * 招待リンクを開いたときの画面（`/j/{code}`）。
 *
 * プレビューも受け入れも要ログイン（ADR 0011）。ログインしていなければ (app) のレイアウトが
 * `/login?next=/j/{code}` に飛ばし、ログインするとここに戻ってくる。
 */
export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const session = useSession();
  const store = useChatStore();
  // まだ分からない間は何も描かない（取得中の画面はデザインにない。docs/ui/README.md の未解決）
  const [state, setState] = useState<InviteAcceptState>();

  useEffect(() => {
    let cancelled = false;
    store
      .previewInvite(code)
      .then((preview) => {
        if (cancelled) return;
        setState({
          status: preview.already_member ? "already_member" : "valid",
          preview: toPreviewView(preview),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const unavailable = unavailableStatus(err);
        if (unavailable) setState({ status: unavailable });
        // 通信の失敗や 500 の画面はデザインにない。何も描かずにコンソールへ出す（ADR 0024 と同じ扱い）
        else console.error("failed to load the invite", err);
      });
    return () => {
      cancelled = true;
    };
  }, [store, code]);

  async function accept() {
    if (state?.status !== "valid") return;
    setState({ ...state, accepting: true });
    try {
      const { workspace } = await store.acceptInvite(code);
      router.replace(`/w/${workspace.id}`);
    } catch (err) {
      // 見ている間に取り消された・期限が切れた・上限に達した
      const unavailable = unavailableStatus(err);
      if (unavailable) setState({ status: unavailable });
      else {
        setState({ ...state, accepting: false });
        console.error("failed to accept the invite", err);
      }
    }
  }

  if (!state) return null;

  return (
    <AuthShell
      footer={
        <>
          別のアカウントで開きますか？{" "}
          <button
            type="button"
            onClick={() => session.logout()}
            className="font-medium text-primary hover:underline"
          >
            ログアウト
          </button>
        </>
      }
    >
      <InviteAccept
        state={state}
        onAccept={accept}
        onOpen={() => state.status === "already_member" && router.replace(`/w/${state.preview.workspace.id}`)}
        homeHref="/"
      />
    </AuthShell>
  );
}

function toPreviewView(preview: InvitePreview): InvitePreviewView {
  return {
    workspace: {
      id: preview.workspace.id,
      name: preview.workspace.name,
      memberCount: preview.workspace.member_count,
      publicRoomCount: preview.workspace.public_room_count,
    },
    inviter: { id: preview.inviter.id, name: preview.inviter.display_name },
  };
}

/** 使えない招待の理由（ADR 0011 のエラー）。それ以外のエラーなら undefined。 */
function unavailableStatus(err: unknown): "invalid" | "expired" | "maxed" | undefined {
  if (!(err instanceof ApiError)) return undefined;
  switch (err.type) {
    case "invite-invalid":
      return "invalid";
    case "invite-expired":
      return "expired";
    case "invite-exhausted":
      return "maxed";
    default:
      // 存在しないコードは not-found で返ることもある（存在を明かさない。ADR 0011）
      return err.status === 404 ? "invalid" : undefined;
  }
}
