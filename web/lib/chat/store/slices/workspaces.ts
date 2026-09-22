
import type {
  Invite,
  InviteAcceptance,
  InvitePolicy,
  InvitePreview,
  RemovalReason,
  Role,
  SetStatusRequest,
  UserStatus,
  Workspace,
} from "@/lib/api/types.gen";
import { statusOf } from "@/lib/chat/store/state";

import type { StoreCore } from "./core";

/**
 * ワークスペースとメンバー（管理画面は ADR 0029、招待は ADR 0030、away とステータスは ADR 0049）。
 */
export function createWorkspaces(
  core: StoreCore,
) {
  const { api, inflight, now, once, patchInvites, patchWorkspace, patchWorkspaceMembers, update, userId } = core;

  /** 管理画面のメンバー一覧を取り直す。 */
  function loadMembers(workspaceId: string): Promise<void> {
    return once(`wsmembers:${workspaceId}`, async () => {
      update((s) => ({
        ...s,
        members: { ...s.members, [workspaceId]: s.members[workspaceId] ?? { status: "loading", list: [] } },
      }));
      try {
        const list = await api.listAllMembers(workspaceId);
        update((s) => ({ ...s, members: { ...s.members, [workspaceId]: { status: "ready", list } } }));
      } catch (err) {
        update((s) => ({
          ...s,
          members: {
            ...s.members,
            [workspaceId]: { status: statusOf(err), list: s.members[workspaceId]?.list ?? [] },
          },
        }));
        console.error("failed to load workspace members", err);
      }
    });
  }

  /** 取得中のものがあれば、それが終わってからもう 1 回取る（reloadRooms と同じ理由）。 */
  async function reloadMembers(workspaceId: string): Promise<void> {
    await inflight.get(`wsmembers:${workspaceId}`);
    return loadMembers(workspaceId);
  }

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

  function removedFromWorkspace(workspaceId: string, reason: RemovalReason) {
    update((s) => {
      const workspace = s.workspaces.list.find((w) => w.id === workspaceId);
      if (!workspace) return s;
      return {
        ...s,
        workspaces: { ...s.workspaces, list: s.workspaces.list.filter((w) => w.id !== workspaceId) },
        removedWorkspaces: { ...s.removedWorkspaces, [workspaceId]: { reason, workspace } },
      };
    });
  }

  /**
   * 手元のメンバーの行に、本人の設定（away / status）を当てる（ADR 0049）。
   *
   * away はユーザーごとの設定なので、読み込んでいるすべてのワークスペース / ルームの行に当てる。
   * status はワークスペースごとなので、そのワークスペースと、そのワークスペースのルームだけに当てる。
   */
  function patchMemberSettings(workspaceId: string, userId: string, away: boolean, status: UserStatus | null) {
    update((s) => {
      const roomsOfWorkspace = new Set(
        Object.values(s.rooms)
          .filter((room) => room?.workspace_id === workspaceId)
          .map((room) => room!.id),
      );

      let members = s.members;
      for (const [id, entry] of Object.entries(s.members)) {
        const sameWorkspace = id === workspaceId;
        if (!entry?.list.some((m) => m.user.id === userId && changed(m, away, status, sameWorkspace))) continue;
        if (members === s.members) members = { ...s.members };
        members[id] = {
          ...entry,
          list: entry.list.map((m) => (m.user.id === userId ? applySettings(m, away, status, sameWorkspace) : m)),
        };
      }

      let roomMembers = s.roomMembers;
      for (const [roomId, entry] of Object.entries(s.roomMembers)) {
        const sameWorkspace = roomsOfWorkspace.has(roomId);
        if (!entry?.members.some((m) => m.user.id === userId && changed(m, away, status, sameWorkspace))) continue;
        if (roomMembers === s.roomMembers) roomMembers = { ...s.roomMembers };
        roomMembers[roomId] = {
          ...entry,
          members: entry.members.map((m) => (m.user.id === userId ? applySettings(m, away, status, sameWorkspace) : m)),
        };
      }

      return members === s.members && roomMembers === s.roomMembers ? s : { ...s, members, roomMembers };
    });
  }

  /** 手元に持っている自分の行から、いまの away を読む（読み込んでいなければ false）。 */
  function myAway(): boolean {
    for (const entry of Object.values(core.state.members)) {
      const me = entry?.list.find((m) => m.user.id === userId);
      if (me) return me.away;
    }
    return false;
  }

  /** 手元に持っている自分の行から、そのワークスペースのステータスを読む。 */
  function myStatus(workspaceId: string): UserStatus | null {
    const me = core.state.members[workspaceId]?.list.find((m) => m.user.id === userId);
    return me?.status ?? null;
  }

  /** 自分の設定を手元に当てる（楽観的更新）。渡さなかった方は変えない。 */
  function patchMySettings(away: boolean | undefined, status: UserStatus | null | undefined, workspaceId?: string) {
    const nextAway = away ?? myAway();
    if (status === undefined) {
      // away だけを変える。ステータスはどのワークスペースのものも触らない
      for (const id of Object.keys(core.state.members)) patchMemberSettings(id, userId, nextAway, myStatus(id));
      return;
    }
    patchMemberSettings(workspaceId!, userId, nextAway, status);
  }

  return {
    patchMemberSettings,
    reloadMembers,
    removedFromWorkspace,
    actions: {
      loadWorkspaces(): Promise<void> {
        return once("workspaces", async () => {
          try {
            const { workspaces } = await api.listWorkspaces();
            update((s) => ({ ...s, workspaces: { status: "ready", list: workspaces } }));
          } catch (err) {
            update((s) => ({ ...s, workspaces: { status: statusOf(err), list: s.workspaces.list } }));
            console.error("failed to load workspaces", err);
          }
        });
      },

      /** 失敗したら ApiError を投げる（入力のエラーはダイアログで扱う）。 */
      async createWorkspace(name: string): Promise<Workspace> {
        const workspace = await api.createWorkspace({ name });
        update((s) => ({ ...s, workspaces: { status: "ready", list: [...s.workspaces.list, workspace] } }));
        return workspace;
      },

      // ---- ワークスペースの管理（ADR 0029） ----

      loadMembers,

      reloadMembers,

      loadInvites,

      /** 名前・招待ポリシーを変える。失敗したら ApiError を投げる（画面は変更前に戻す）。 */
      async updateWorkspace(workspaceId: string, patch: { name?: string; invitePolicy?: InvitePolicy }): Promise<void> {
        const updated = await api.updateWorkspace(workspaceId, {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.invitePolicy === undefined ? {} : { invite_policy: patch.invitePolicy }),
        });
        patchWorkspace(workspaceId, (workspace) => ({ ...workspace, ...updated }));
      },

      /** ロールを変える。失敗したら ApiError を投げる。 */
      /**
       * 手動の離席を設定 / 解除する（ADR 0049 決定 4）。手元で先に反映し、失敗したら元に戻す。
       * サーバーからは member.status_changed が本人のすべての接続にも届くので、別のタブも揃う。
       */
      async setAway(away: boolean): Promise<void> {
        const before = myAway();
        patchMySettings(away, undefined);
        try {
          await api.setManualAway(away);
        } catch (error) {
          patchMySettings(before, undefined);
          throw error;
        }
      },

      /** カスタムステータスを設定する（ワークスペースごと）。status が null なら解除。 */
      async setStatus(workspaceId: string, status: SetStatusRequest | null): Promise<void> {
        const before = myStatus(workspaceId);
        patchMySettings(
          undefined,
          status === null ? null : { emoji: status.emoji, text: status.text, expires_at: status.expires_at ?? null },
          workspaceId,
        );
        try {
          if (status === null) await api.clearStatus(workspaceId);
          else await api.setStatus(workspaceId, status);
        } catch (error) {
          patchMySettings(undefined, before, workspaceId);
          throw error;
        }
      },

      /**
       * プロフィールのパネルの email を取る（ADR 0050 決定 1）。**ストアには入れない。**
       * email には変更のイベントが無いので、置いておくと WebSocket でも再接続の同期でも更新されない値が残る。
       * パネルを開くたびに取り直す。失敗したら ApiError を投げる（外された人は 404）。
       */
      async getMemberEmail(workspaceId: string, targetUserId: string): Promise<string | null> {
        return (await api.getMemberProfile(workspaceId, targetUserId)).email;
      },

      async changeMemberRole(workspaceId: string, targetUserId: string, role: Role): Promise<void> {
        const member = await api.changeMemberRole(workspaceId, targetUserId, role);
        patchWorkspaceMembers(workspaceId, (list) => list.map((m) => (m.user.id === targetUserId ? member : m)));
        if (targetUserId === userId) patchWorkspace(workspaceId, (workspace) => ({ ...workspace, my_role: role }));
      },

      /**
       * キック（targetUserId が自分なら退出）。失敗したら ApiError を投げる。
       * 自分が抜けたときの画面の後始末は workspace.member_removed のイベントで行う（別の端末でも同じになる）。
       */
      async removeMember(workspaceId: string, targetUserId: string): Promise<void> {
        await api.removeMember(workspaceId, targetUserId);
        patchWorkspaceMembers(workspaceId, (list) => list.filter((m) => m.user.id !== targetUserId));
        if (targetUserId === userId) removedFromWorkspace(workspaceId, "left");
      },

      /**
       * owner を譲渡する。自分は admin になる（ADR 0011）。失敗したら ApiError を投げる。
       * 応答に本文がないので、手元のロールは自分で入れ替える（イベントでも同じ値が届く）。
       */
      async transferOwnership(workspaceId: string, targetUserId: string): Promise<void> {
        await api.transferOwnership(workspaceId, targetUserId);
        patchWorkspaceMembers(workspaceId, (list) =>
          list.map((m) => {
            if (m.user.id === targetUserId) return { ...m, role: "owner" };
            return m.role === "owner" ? { ...m, role: "admin" } : m;
          }),
        );
        patchWorkspace(workspaceId, (workspace) => ({ ...workspace, my_role: "admin" }));
      },

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

export type Workspaces = ReturnType<typeof createWorkspaces>;

/** away / status を当てた行を返す（同じワークスペースでなければ status は触らない）。 */
export function applySettings<T extends { away: boolean; status: UserStatus | null }>(
  member: T,
  away: boolean,
  status: UserStatus | null,
  sameWorkspace: boolean,
): T {
  return { ...member, away, status: sameWorkspace ? status : member.status };
}

/** 当てても値が変わらないなら、その一覧は作り直さない。 */
export function changed(
  member: { away: boolean; status: UserStatus | null },
  away: boolean,
  status: UserStatus | null,
  sameWorkspace: boolean,
): boolean {
  if (member.away !== away) return true;
  if (!sameWorkspace) return false;
  return JSON.stringify(member.status ?? null) !== JSON.stringify(status ?? null);
}
