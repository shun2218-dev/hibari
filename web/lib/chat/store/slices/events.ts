import type { ServerEvent } from "@/lib/api/types.gen";
import { belongsTo, insertActivity, parseActivityListKey, removeActivity } from "@/lib/chat/store/activity-feed";
import { applyReadToRoom } from "@/lib/chat/store/messages";
import { applyThreadNotify } from "@/lib/chat/store/threads";
import type { StoreCore } from "./core";
import type { Workspaces } from "./workspaces";
import type { Activity } from "./activity";
import type { Saved } from "./saved";
import type { Threads } from "./threads";
import type { Typing } from "./typing";
import type { Timeline } from "./timeline";
import type { Rooms } from "./rooms";

/**
 * イベント（WebSocket で届いたものを状態に当てる）。
 */
export function createEvents(
  core: StoreCore,
  { workspaces, activity, saved, threads, typing, timeline, rooms }: { workspaces: Workspaces; activity: Activity; saved: Saved; threads: Threads; typing: Typing; timeline: Timeline; rooms: Rooms },
) {
  const { patchMembers, patchRoom, patchThread, patchThreadList, patchWorkspaceMembers, update, userId } = core;
  const { patchMemberSettings, reloadMembers, removedFromWorkspace } = workspaces;
  const { patchActivityItems, receiveActivityChange, receiveActivityMessage, reloadActivity, roomReadAdvanced } = activity;
  const { receiveSaved } = saved;
  const { advanceThreadRead, receiveThreadTyping, reloadThreads } = threads;
  const { receiveTyping, removeTyping } = typing;
  const { receiveMessage, refreshRoom } = timeline;
  const { joinedRoom, reloadRoomMembers, removedFromRoom, roomDeleted } = rooms;

  function applyEvent(event: ServerEvent) {
    switch (event.type) {
      case "message.created":
        receiveMessage(event.data, true);
        receiveActivityMessage(event.data);
        return;
      case "message.updated":
      case "message.deleted":
        receiveMessage(event.data, false);
        receiveActivityChange(event.data);
        return;

      case "member.joined": {
        const { workspace_id, room_id, user } = event.data;
        // ワークスペースに入った人のイベントはない（docs/events.md）。招待の受け入れは既定のルームへの参加として届くので、
        // 管理画面を開いていて、まだ一覧にいない人なら取り直す
        if (core.state.members[workspace_id] && !core.state.members[workspace_id].list.some((m) => m.user.id === user.id)) {
          void reloadMembers(workspace_id);
        }
        if (user.id === userId) {
          void joinedRoom(workspace_id, room_id);
          return;
        }
        if (core.state.roomMembers[room_id]) void reloadRoomMembers(room_id);
        if (core.state.rooms[room_id]?.member_count !== undefined) void refreshRoom(room_id);
        return;
      }
      case "member.left": {
        const { room_id, user_id } = event.data;
        // 自分のことは room.member_removed で扱う
        if (user_id === userId) return;
        patchMembers(room_id, (members) =>
          members.some((m) => m.user.id === user_id) ? members.filter((m) => m.user.id !== user_id) : members,
        );
        if (core.state.rooms[room_id]?.member_count !== undefined) void refreshRoom(room_id);
        removeTyping(room_id, user_id);
        return;
      }
      case "room.updated": {
        // アーカイブ・復元も同じイベントで届く（ADR 0059 決定 5）。読めることは変わらないので、購読はそのまま
        const { room_id, name, is_default, archived_at } = event.data;
        patchRoom(room_id, (room) =>
          room.name === name && room.is_default === is_default && room.archived_at === archived_at
            ? room
            : { ...room, name, is_default, archived_at },
        );
        return;
      }
      case "room.deleted":
        roomDeleted(event.data.workspace_id, event.data.room_id, "removed");
        return;
      case "room.member_removed":
        removedFromRoom(event.data.workspace_id, event.data.room_id, event.data.reason);
        // 読めなくなったルームの 1 件は、取り直すと消える（決定 4）
        void reloadActivity(event.data.workspace_id);
        return;
      case "room.read":
        patchRoom(event.data.room_id, (room) =>
          applyReadToRoom(room, {
            lastReadSeq: event.data.last_read_seq,
            lastReadUserSeq: event.data.last_read_user_seq,
            mentionCount: event.data.mention_count,
          }),
        );
        roomReadAdvanced(event.data.room_id, event.data.last_read_user_seq);
        return;

      case "workspace.updated": {
        const { workspace_id, name, invite_policy } = event.data;
        update((s) => ({
          ...s,
          workspaces: {
            ...s.workspaces,
            list: s.workspaces.list.map((w) => (w.id === workspace_id ? { ...w, name, invite_policy } : w)),
          },
        }));
        return;
      }
      case "workspace.member_removed":
        patchWorkspaceMembers(event.data.workspace_id, (list) =>
          list.some((m) => m.user.id === event.data.user_id)
            ? list.filter((m) => m.user.id !== event.data.user_id)
            : list,
        );
        // ほかの人のことは、ルームごとの member.left で扱う
        if (event.data.user_id === userId) removedFromWorkspace(event.data.workspace_id, event.data.reason);
        return;
      case "workspace.role_changed": {
        const { workspace_id, user_id, role } = event.data;
        patchWorkspaceMembers(workspace_id, (list) =>
          list.some((m) => m.user.id === user_id && m.role !== role)
            ? list.map((m) => (m.user.id === user_id ? { ...m, role } : m))
            : list,
        );
        update((s) => {
          const roomMembers = { ...s.roomMembers };
          for (const [roomId, entry] of Object.entries(s.roomMembers)) {
            if (!entry || s.rooms[roomId]?.workspace_id !== workspace_id) continue;
            if (!entry.members.some((m) => m.user.id === user_id && m.role !== role)) continue;
            roomMembers[roomId] = {
              ...entry,
              members: entry.members.map((m) => (m.user.id === user_id ? { ...m, role } : m)),
            };
          }
          const list =
            user_id === userId
              ? s.workspaces.list.map((w) => (w.id === workspace_id ? { ...w, my_role: role } : w))
              : s.workspaces.list;
          return { ...s, roomMembers, workspaces: { ...s.workspaces, list } };
        });
        return;
      }
      case "presence.changed": {
        // 自動で決まる状態だけが届く。手動の離席とカスタムステータスは member.status_changed（ADR 0049）
        const { user_id, presence } = event.data;
        update((s) => {
          let rooms = s.rooms;
          for (const room of Object.values(s.rooms)) {
            if (room?.dm_peer?.id !== user_id || room.dm_peer.presence === presence) continue;
            if (rooms === s.rooms) rooms = { ...s.rooms };
            rooms[room.id] = { ...room, dm_peer: { ...room.dm_peer, presence } };
          }
          let roomMembers = s.roomMembers;
          for (const [roomId, entry] of Object.entries(s.roomMembers)) {
            if (!entry?.members.some((m) => m.user.id === user_id && m.presence !== presence)) continue;
            if (roomMembers === s.roomMembers) roomMembers = { ...s.roomMembers };
            roomMembers[roomId] = {
              ...entry,
              members: entry.members.map((m) => (m.user.id === user_id ? { ...m, presence } : m)),
            };
          }
          let members = s.members;
          for (const [workspaceId, entry] of Object.entries(s.members)) {
            if (!entry?.list.some((m) => m.user.id === user_id && m.presence !== presence)) continue;
            if (members === s.members) members = { ...s.members };
            members[workspaceId] = {
              ...entry,
              list: entry.list.map((m) => (m.user.id === user_id ? { ...m, presence } : m)),
            };
          }
          return rooms === s.rooms && roomMembers === s.roomMembers && members === s.members
            ? s
            : { ...s, rooms, roomMembers, members };
        });
        return;
      }
      case "member.status_changed": {
        // 本人が選んだ設定（手動の離席とカスタムステータス。ADR 0049 決定 8）。
        // away はユーザーごとなので、どのワークスペースの行にも同じ値を当てる。status はワークスペースごと
        const { workspace_id, user_id, away, status } = event.data;
        patchMemberSettings(workspace_id, user_id, away, status);
        return;
      }
      case "typing.started":
        // スレッドでの入力はチャンネルの入力中に出さない。スレッドのパネルに出すのは構築順 5（ADR 0036）
        if (event.data.thread_root_id !== null) receiveThreadTyping(event.data.thread_root_id, event.data.user);
        else receiveTyping(event.data.room_id, event.data.user);
        return;
      case "thread.read":
        advanceThreadRead(event.data.room_id, event.data.thread_root_id, event.data.last_read_thread_seq);
        return;
      case "saved.updated":
        receiveSaved(event.data);
        return;
      case "thread.notifications_updated": {
        // 本人の別のタブ・端末で切り替えた（ADR 0056）。フォローで参加したときは、先に届く thread.followed で一覧を取り直している
        const { workspace_id, thread_root_id, notify_replies } = event.data;
        patchThreadList(workspace_id, (list) => applyThreadNotify(list, thread_root_id, notify_replies));
        // 設定はそのときの値で当てはめるので（ADR 0058 決定 2）、過去の 1 件も増減する。取り直す
        void reloadActivity(workspace_id);
        return;
      }
      case "notifications.updated":
        // 本人の別のタブ・端末で変えた（ADR 0055 決定 5）
        update((s) => ({
          ...s,
          notificationLevels: { ...s.notificationLevels, [event.data.workspace_id]: event.data.level },
        }));
        void reloadActivity(event.data.workspace_id);
        return;
      case "room.notifications_updated": {
        const { level, muted, muted_until } = event.data;
        patchRoom(event.data.room_id, (room) => ({ ...room, notifications: { level, muted, muted_until } }));
        void reloadActivity(event.data.workspace_id);
        return;
      }
      case "activity.reaction_added": {
        // 自分のメッセージへのリアクション（ADR 0058 決定 9）。未読を持たないので、件数は変わらない
        const { item } = event.data;
        patchActivityItems(event.data.workspace_id, (items, key) => {
          const { filter, unreadOnly } = parseActivityListKey(key);
          return belongsTo(item, filter, unreadOnly) ? insertActivity(items, item) : items;
        });
        return;
      }
      case "activity.reaction_removed":
        patchActivityItems(event.data.workspace_id, (items) => removeActivity(items, (i) => i.id === event.data.id));
        return;
      case "thread.followed": {
        // 誰が参加するかはサーバーが決める。一覧の 1 行（親の冒頭など）はイベントにないので取り直す
        const { thread_root_id, last_read_thread_seq, workspace_id } = event.data;
        patchThread(thread_root_id, (t) =>
          t.lastReadThreadSeq !== null ? t : { ...t, lastReadThreadSeq: last_read_thread_seq },
        );
        void reloadThreads(workspace_id);
        return;
      }
    }
  }

  return {
    actions: {
      // ---- リアルタイム ----

      applyEvent,
    },
  };
}

export type Events = ReturnType<typeof createEvents>;
