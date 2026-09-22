import type { InvitePolicy, RemovalReason, Workspace } from "@/lib/api/types.gen";

import type { StoreCore } from "./core";
import { statusOf } from "./state";

/**
 * ワークスペース（ADR 0006）。一覧・作成・設定の更新と、自分が外されたときの後始末。
 */
export function createWorkspaces(core: StoreCore) {
  const { api, once, patchWorkspace, update } = core;

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

  return {
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

      /** 名前・招待ポリシーを変える。失敗したら ApiError を投げる（画面は変更前に戻す）。 */
      async updateWorkspace(workspaceId: string, patch: { name?: string; invitePolicy?: InvitePolicy }): Promise<void> {
        const updated = await api.updateWorkspace(workspaceId, {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.invitePolicy === undefined ? {} : { invite_policy: patch.invitePolicy }),
        });
        patchWorkspace(workspaceId, (workspace) => ({ ...workspace, ...updated }));
      },
    },
  };
}

export type Workspaces = ReturnType<typeof createWorkspaces>;
