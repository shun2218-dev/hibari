import type { Role, UserStatus } from "@/lib/api/types.gen";

import type { StoreCore } from "./core";
import { statusOf } from "./state";
import type { Workspaces } from "./workspaces";

/**
 * ワークスペースのメンバー（管理画面。ADR 0029）。一覧・ロールの変更・キック・オーナーの譲渡と、
 * 届いた presence とステータスを手元の行に当てる処理（ADR 0049）。
 */
export function createMembers(core: StoreCore, { workspaces }: { workspaces: Workspaces }) {
  const { api, inflight, once, patchWorkspace, patchWorkspaceMembers, update, userId } = core;
  const { removedFromWorkspace } = workspaces;

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

  return {
    patchMemberSettings,
    reloadMembers,
    actions: {
      loadMembers,

      reloadMembers,

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
    },
  };
}

export type Members = ReturnType<typeof createMembers>;

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
