import type { Invite, InviteAcceptance, InvitePreview } from "@/lib/api/types.gen";

import type { StoreCore } from "./core";
import { statusOf } from "./state";

/**
 * 招待リンク（ADR 0030）。作成・一覧・取り消しと、受け取る側のプレビューと受け入れ。
 */
export function createInvites(core: StoreCore) {
  const { api, now, once, patchInvites, update } = core;

  /** 招待は作られた順に返る（ID は ULID）ので、新しい順にして持つ。 */
  function sortInvites(list: Invite[]): Invite[] {
    return [...list].sort((a, b) => b.id.localeCompare(a.id));
  }

  function loadInvites(workspaceId: string): Promise<void> {
    return once(`invites:${workspaceId}`, async () => {
      update((s) => ({
        ...s,
        invites: { ...s.invites, [workspaceId]: s.invites[workspaceId] ?? { status: "loading", list: [] } },
      }));
      try {
        const list = await api.listAllInvites(workspaceId);
        update((s) => ({ ...s, invites: { ...s.invites, [workspaceId]: { status: "ready", list: sortInvites(list) } } }));
      } catch (err) {
        update((s) => ({
          ...s,
          invites: {
            ...s.invites,
            [workspaceId]: { status: statusOf(err), list: s.invites[workspaceId]?.list ?? [] },
          },
        }));
        console.error("failed to load invites", err);
      }
    });
  }

  return {
    actions: {
      loadInvites,

      /** 招待リンクを作る。code はこの戻り値にしか入らない（ADR 0006）。失敗したら ApiError を投げる。 */
      async createInvite(workspaceId: string, input: { maxUses: number | null; expiresInSeconds: number }): Promise<Invite> {
        const invite = await api.createInvite(workspaceId, {
          max_uses: input.maxUses,
          expires_in_seconds: input.expiresInSeconds,
        });
        // 一覧には code を残さない。閉じた後に再表示できてしまわないようにする
        const listed = { ...invite };
        delete listed.code;
        patchInvites(workspaceId, (list) => [listed, ...list]);
        return invite;
      },

      /** 招待リンクを取り消す。失敗したら ApiError を投げる。 */
      async revokeInvite(workspaceId: string, inviteId: string): Promise<void> {
        await api.revokeInvite(workspaceId, inviteId);
        patchInvites(workspaceId, (list) =>
          list.map((invite) =>
            invite.id === inviteId
              ? { ...invite, status: "revoked", revoked_at: new Date(now()).toISOString() }
              : invite,
          ),
        );
      },

      // ---- 招待の受け入れ（ADR 0030） ----

      /** 招待リンクの内容を見る。使えない招待は ApiError（404 / 410）を投げる。 */
      previewInvite(code: string): Promise<InvitePreview> {
        return api.previewInvite(code);
      },

      /**
       * 招待を受け入れて、ワークスペースを一覧に足す。すでにメンバーなら足すだけで何も変わらない。
       * 失敗したら ApiError を投げる。
       */
      async acceptInvite(code: string): Promise<InviteAcceptance> {
        const result = await api.acceptInvite(code);
        update((s) =>
          s.workspaces.list.some((w) => w.id === result.workspace.id)
            ? s
            : { ...s, workspaces: { ...s.workspaces, list: [...s.workspaces.list, result.workspace] } },
        );
        return result;
      },
    },
  };
}

export type Invites = ReturnType<typeof createInvites>;
