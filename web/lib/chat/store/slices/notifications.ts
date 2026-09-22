
import type { NotifyLevel, RoomNotifications } from "@/lib/api/types.gen";

import type { StoreCore } from "./core";

/**
 * ミュートと通知の設定（ADR 0055）。
 */
export function createNotifications(
  core: StoreCore,
) {
  const { api, once, patchRoom, update } = core;



  return {
    actions: {
      /**
       * 全体の通知の設定を取る（ADR 0055）。再接続の後にも取り直す（realtime.ts。change_seq に乗らないため）。
       * 取れなくても既定の mentions として描けるので、失敗はログだけにする。
       */
      loadNotificationLevel(workspaceId: string): Promise<void> {
        return once(`notification-level:${workspaceId}`, async () => {
          try {
            const { level } = await api.getNotificationLevel(workspaceId);
            update((s) => ({ ...s, notificationLevels: { ...s.notificationLevels, [workspaceId]: level } }));
          } catch (err) {
            console.error("failed to load notification level", err);
          }
        });
      },

      /** 全体の通知の設定を変える。手元で先に反映し、失敗したら元に戻して ApiError を投げる。 */
      async setNotificationLevel(workspaceId: string, level: NotifyLevel): Promise<void> {
        const before = core.state.notificationLevels[workspaceId];
        update((s) => ({ ...s, notificationLevels: { ...s.notificationLevels, [workspaceId]: level } }));
        try {
          await api.setNotificationLevel(workspaceId, level);
        } catch (error) {
          update((s) => ({ ...s, notificationLevels: { ...s.notificationLevels, [workspaceId]: before } }));
          throw error;
        }
      },

      /**
       * ルームごとの設定を全部の値で置き換える（ADR 0055 決定 4）。メニューで 1 つを変えるときも、手元の残りの値と一緒に送る。
       * 手元で先に反映し、失敗したら元に戻して ApiError を投げる。応答（期限を落とした後の値）で上書きする。
       */
      async setRoomNotifications(roomId: string, next: RoomNotifications): Promise<void> {
        const before = core.state.rooms[roomId]?.notifications;
        if (before === undefined || before === null) return;
        patchRoom(roomId, (room) => ({ ...room, notifications: next }));
        try {
          const saved = await api.setRoomNotifications(roomId, next);
          patchRoom(roomId, (room) => ({ ...room, notifications: saved }));
        } catch (error) {
          patchRoom(roomId, (room) => ({ ...room, notifications: before }));
          throw error;
        }
      },
    },
  };
}

export type Notifications = ReturnType<typeof createNotifications>;
