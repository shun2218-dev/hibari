
import type { RemovalReason, Room, RoomKind } from "@/lib/api/types.gen";
import { insertByActivity } from "@/lib/chat/rules/messages";
import { statusOf } from "./state";

import type { StoreCore } from "./core";
import type { Activity } from "./activity";
import type { Saved } from "./saved";
import type { Timeline } from "./timeline";
import type { Send } from "./send";

/**
 * ルーム（一覧・作成・設定・参加と退出・アーカイブと削除）。
 */
export function createRooms(
  core: StoreCore,
  { activity, saved, timeline, send }: { activity: Activity; saved: Saved; timeline: Timeline; send: Send },
) {
  const { addRoom, api, inflight, once, patchMembers, patchRoom, patchRoomList, patchThreadList, patchTimeline, putRoom, update, userId } = core;
  const { reloadActivity } = activity;
  const { refreshSavedCount, reloadSavedTabs } = saved;
  const { refreshRoom } = timeline;
  const { dropOutgoing } = send;

  function loadRooms(workspaceId: string): Promise<void> {
    return once(`rooms:${workspaceId}`, async () => {
      update((s) =>
        s.roomLists[workspaceId]
          ? s
          : { ...s, roomLists: { ...s.roomLists, [workspaceId]: { status: "loading", ids: [] } } },
      );
      try {
        const { rooms, unread_thread_count } = await api.listRooms(workspaceId);
        for (const room of rooms) putRoom(room);
        const ids = rooms.map((r) => r.id);
        update((s) => ({
          ...s,
          roomLists: { ...s.roomLists, [workspaceId]: { status: "ready", ids } },
          unreadThreadCounts: { ...s.unreadThreadCounts, [workspaceId]: unread_thread_count },
        }));
      } catch (err) {
        update((s) => ({
          ...s,
          roomLists: {
            ...s.roomLists,
            [workspaceId]: { status: statusOf(err), ids: s.roomLists[workspaceId]?.ids ?? [] },
          },
        }));
        if (statusOf(err) === "error") console.error("failed to load rooms", err);
      }
    });
  }

  function reloadRoomMembers(roomId: string): Promise<void> {
    return once(`members:${roomId}`, async () => {
      update((s) => ({
        ...s,
        roomMembers: { ...s.roomMembers, [roomId]: s.roomMembers[roomId] ?? { status: "loading", members: [] } },
      }));
      try {
        const members = await api.listAllRoomMembers(roomId);
        update((s) => ({ ...s, roomMembers: { ...s.roomMembers, [roomId]: { status: "ready", members } } }));
      } catch (err) {
        update((s) => ({
          ...s,
          roomMembers: {
            ...s.roomMembers,
            [roomId]: { status: statusOf(err), members: s.roomMembers[roomId]?.members ?? [] },
          },
        }));
        console.error("failed to load room members", err);
      }
    });
  }

  /** 自分がルームのメンバーになった（別のタブでの作成・参加、DM、追加、招待の受け入れ）。 */
  function joinedRoom(workspaceId: string, roomId: string): Promise<void> {
    return once(`joined:${roomId}`, async () => {
      let room: Room;
      try {
        room = await api.getRoom(roomId);
      } catch (err) {
        console.error("failed to load a joined room", err);
        return;
      }
      putRoom(room);
      update((s) => {
        if (!s.removedRooms[roomId]) return s;
        return { ...s, removedRooms: { ...s.removedRooms, [roomId]: undefined } };
      });
      patchRoomList(workspaceId, (ids) => (ids.includes(roomId) ? ids : insertByActivity(ids, room, core.state.rooms)));
    });
  }

  function removedFromRoom(workspaceId: string, roomId: string, reason: RemovalReason) {
    const room = core.state.rooms[roomId];
    // ルームを抜けるとスレッドへの参加も消える（thread_members は room_members への FK を持つ。ADR 0036）
    patchThreadList(workspaceId, (list) =>
      list.some((t) => t.room.id === roomId) ? list.filter((t) => t.room.id !== roomId) : list,
    );
    update((s) => {
      const ids = Object.entries(s.threads).flatMap(([id, t]) => (t?.roomId === roomId ? [id] : []));
      if (ids.length === 0) return s;
      const threads = { ...s.threads };
      for (const id of ids) threads[id] = room?.kind === "public" ? { ...threads[id]!, lastReadThreadSeq: null } : undefined;
      return { ...s, threads };
    });
    if (room?.kind === "public") {
      // 参加していなくても読めるので、一覧にも画面にも残し、参加していない状態に戻す
      patchRoom(roomId, (r) => ({ ...r, is_member: false, last_read_seq: null, unread_count: 0 }));
      patchTimeline(roomId, { unreadAfterSeq: null });
      return;
    }
    update((s) => ({
      ...s,
      removedRooms: { ...s.removedRooms, [roomId]: reason },
      timelines: { ...s.timelines, [roomId]: undefined },
      roomMembers: { ...s.roomMembers, [roomId]: undefined },
      typing: { ...s.typing, [roomId]: undefined },
    }));
    // もう投稿できない。送信中のものは届かず、再送もできない
    dropOutgoing(roomId);
    // 開いていても一覧からはすぐに消す。名前も含めて、もう見せてよいものではない（ADR 0035）
    patchRoomList(workspaceId, (ids) => ids.filter((id) => id !== roomId));
  }

  /**
   * ルームが削除された（ADR 0059 決定 7）。そのルームのものを全部捨てる（一覧・メッセージ・メンバー・ピン留め・スレッド・送信中）。
   * 「後で」とアクティビティは、行がサーバーで消えているので取り直す。
   *
   * reason は、開いている画面に何を出すか。自分で消した（left）なら黙って入口に戻し、ほかの人が消した（removed）なら
   * 「アクセスできません」を出す（ADR 0035。存在しないのか読めないのかを区別しない）。自分で消した直後に自分宛ての
   * room.deleted が届いても、left のままにする（入口に戻る途中で「アクセスできません」を挟まない）。
   */
  function roomDeleted(workspaceId: string, roomId: string, reason: RemovalReason) {
    patchThreadList(workspaceId, (list) =>
      list.some((t) => t.room.id === roomId) ? list.filter((t) => t.room.id !== roomId) : list,
    );
    update((s) => {
      const threads = { ...s.threads };
      for (const [id, t] of Object.entries(s.threads)) if (t?.roomId === roomId) threads[id] = undefined;
      return {
        ...s,
        threads,
        removedRooms: { ...s.removedRooms, [roomId]: s.removedRooms[roomId] === "left" ? "left" : reason },
        timelines: { ...s.timelines, [roomId]: undefined },
        roomMembers: { ...s.roomMembers, [roomId]: undefined },
        typing: { ...s.typing, [roomId]: undefined },
        pins: { ...s.pins, [roomId]: undefined },
      };
    });
    dropOutgoing(roomId);
    patchRoomList(workspaceId, (ids) => ids.filter((id) => id !== roomId));
    if (core.state.saved[workspaceId]?.cursor != null) {
      void reloadSavedTabs(workspaceId);
      void refreshSavedCount(workspaceId);
    }
    void reloadActivity(workspaceId);
  }

  return {
    joinedRoom,
    reloadRoomMembers,
    removedFromRoom,
    roomDeleted,
    actions: {
      loadRooms,

      /**
       * 一覧を取り直す。取得中のものがあれば、それが終わってからもう 1 回取る。
       * 購読の後に取り直すとき（realtime.ts）に、購読より前に始まった取得の結果で済ませないため。
       */
      async reloadRooms(workspaceId: string): Promise<void> {
        await inflight.get(`rooms:${workspaceId}`);
        return loadRooms(workspaceId);
      },

      /** 失敗したら ApiError を投げる。 */
      async createRoom(workspaceId: string, input: { kind: Exclude<RoomKind, "dm">; name: string }): Promise<Room> {
        return addRoom(workspaceId, await api.createRoom(workspaceId, input));
      },

      /**
       * 相手との DM を開く。すでにあれば同じルームが返る（`dm_key` の UNIQUE。ADR 0011）。
       * 失敗したら ApiError を投げる。
       */
      async openDm(workspaceId: string, userId: string): Promise<Room> {
        return addRoom(workspaceId, await api.createRoom(workspaceId, { kind: "dm", user_id: userId }));
      },

      /** ルームの名前を変える。失敗したら ApiError を投げる。 */
      async updateRoom(roomId: string, patch: { name?: string; isDefault?: boolean }): Promise<void> {
        putRoom(
          await api.updateRoom(roomId, {
            ...(patch.name === undefined ? {} : { name: patch.name }),
            ...(patch.isDefault === undefined ? {} : { is_default: patch.isDefault }),
          }),
        );
      },

      /**
       * 非公開ルームに人を追加する。応答に本文がないので、メンバー一覧とルーム（人数）を取り直す。
       * 失敗したら ApiError を投げる。
       */
      async addRoomMember(roomId: string, userId: string): Promise<void> {
        await api.addRoomMember(roomId, userId);
        await Promise.all([reloadRoomMembers(roomId), refreshRoom(roomId)]);
      },

      /** ルームから外す。失敗したら ApiError を投げる。 */
      async removeRoomMember(roomId: string, userId: string): Promise<void> {
        await api.removeRoomMember(roomId, userId);
        patchMembers(roomId, (members) => members.filter((m) => m.user.id !== userId));
        await refreshRoom(roomId);
      },

      /**
       * 自分でルームから退出する。失敗したら ApiError を投げる。
       * 後始末は room.member_removed（reason: left）と同じにする。イベントは別の端末にも届くので同じ結果になるが、
       * WS が切れていると届かないので、この端末では応答を待ってすぐに行う（ワークスペースの退出と同じ）。
       */
      async leaveRoom(roomId: string): Promise<void> {
        await api.removeRoomMember(roomId, userId);
        const workspaceId = core.state.rooms[roomId]?.workspace_id;
        if (workspaceId) removedFromRoom(workspaceId, roomId, "left");
      },

      /** アーカイブする（ADR 0059）。失敗したら ApiError を投げる。ほかの端末には room.updated で届く。 */
      async archiveRoom(roomId: string): Promise<void> {
        putRoom(await api.archiveRoom(roomId));
      },

      /** アーカイブを戻す。失敗したら ApiError を投げる。 */
      async unarchiveRoom(roomId: string): Promise<void> {
        putRoom(await api.unarchiveRoom(roomId));
      },

      /**
       * 削除する（ADR 0059）。失敗したら ApiError を投げる。
       * 後始末は room.deleted と同じだが、自分で消したので開いている画面は黙って入口に戻す（退出と同じ。reason: left）。
       * WS が切れていると room.deleted が届かないので、応答を待ってすぐに行う。
       */
      async deleteRoom(roomId: string): Promise<void> {
        const workspaceId = core.state.rooms[roomId]?.workspace_id;
        await api.deleteRoom(roomId);
        if (workspaceId) roomDeleted(workspaceId, roomId, "left");
      },

      /** public ルームに参加する。失敗したら ApiError を投げる。 */
      async joinRoom(roomId: string): Promise<void> {
        putRoom(await api.joinRoom(roomId));
      },

      loadRoomMembers: reloadRoomMembers,
    },
  };
}

export type Rooms = ReturnType<typeof createRooms>;
