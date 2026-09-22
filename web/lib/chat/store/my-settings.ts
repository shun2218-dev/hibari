import type { SetStatusRequest, UserStatus } from "@/lib/api/types.gen";

import type { StoreCore } from "./core";
import type { Members } from "./members";

/**
 * 自分が選んだ設定（手動の離席とカスタムステータス。ADR 0049）。手元に先に当ててから送る。
 */
export function createMySettings(core: StoreCore, { members }: { members: Members }) {
  const { api, userId } = core;
  const { patchMemberSettings } = members;

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
    actions: {
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
    },
  };
}

export type MySettings = ReturnType<typeof createMySettings>;
