import type { ActivityFilter, ActivityItem, Message } from "@/lib/api/types.gen";
import { notifyReasons } from "@/lib/chat/notifications/desktop-notification";
import {
  activityListKey,
  type ActivityListState,
  applyRoomReadToActivity,
  belongsTo,
  insertActivity,
  messageActivityItem,
  parseActivityListKey,
  removeActivity,
} from "@/lib/chat/rules/activity-feed";
import { inChannel } from "@/lib/chat/rules/messages";
import { type ChatState, MAX_UNREAD_ACTIVITY } from "./state";

import type { StoreCore } from "./core";

/**
 * アクティビティ（ADR 0058）。
 */
export function createActivity(
  core: StoreCore,
) {
  const { api, now, once, update, userId } = core;

  // ---- アクティビティ（ADR 0058） ----

  // 未読の件数に足したメッセージ。同じメッセージが送信の応答と message.created の両方で届いても、1 回だけ数える
  const countedActivity = new Set<string>();

  function patchActivity(
    workspaceId: string,
    recipe: (activity: NonNullable<ChatState["activity"][string]>) => NonNullable<ChatState["activity"][string]>,
  ) {
    update((s) => {
      const current = s.activity[workspaceId] ?? { lists: {}, unreadCount: null };
      const next = recipe(current);
      return next === current ? s : { ...s, activity: { ...s.activity, [workspaceId]: next } };
    });
  }

  /** 読み込んだ一覧すべての 1 件ずつを書き換える。変わらない一覧は作り直さない。 */
  function patchActivityItems(workspaceId: string, recipe: (items: ActivityItem[], key: string) => ActivityItem[]) {
    patchActivity(workspaceId, (activity) => {
      let lists = activity.lists;
      for (const [key, list] of Object.entries(activity.lists)) {
        if (!list || list.status !== "ready") continue;
        const items = recipe(list.items, key);
        if (items === list.items) continue;
        if (lists === activity.lists) lists = { ...activity.lists };
        lists[key] = { ...list, items };
      }
      return lists === activity.lists ? activity : { ...activity, lists };
    });
  }

  function loadActivityList(workspaceId: string, filter: ActivityFilter, unreadOnly: boolean, reload = false): Promise<void> {
    const key = activityListKey(filter, unreadOnly);
    if (!reload && core.state.activity[workspaceId]?.lists[key]?.status === "ready") return Promise.resolve();
    return once(`activity:${workspaceId}:${key}`, async () => {
      patchActivity(workspaceId, (activity) =>
        activity.lists[key]
          ? activity
          : { ...activity, lists: { ...activity.lists, [key]: { status: "loading", items: [], nextCursor: null, loadingMore: false } } },
      );
      try {
        const page = await api.listActivity(workspaceId, { filter, unreadOnly });
        patchActivity(workspaceId, (activity) => ({
          ...activity,
          lists: {
            ...activity.lists,
            [key]: { status: "ready", items: page.items, nextCursor: page.next_cursor, loadingMore: false },
          },
        }));
      } catch (err) {
        patchActivity(workspaceId, (activity) => ({
          ...activity,
          lists: {
            ...activity.lists,
            [key]: { status: "error", items: activity.lists[key]?.items ?? [], nextCursor: null, loadingMore: false },
          },
        }));
        console.error("failed to load activity", err);
      }
    });
  }

  function loadActivityUnreadCount(workspaceId: string): Promise<void> {
    return once(`activity-count:${workspaceId}`, async () => {
      try {
        const { count } = await api.activityUnreadCount(workspaceId);
        patchActivity(workspaceId, (activity) => (activity.unreadCount === count ? activity : { ...activity, unreadCount: count }));
      } catch (err) {
        console.error("failed to count unread activity", err);
      }
    });
  }

  /**
   * 手元で合わせきれない変化（通知の設定・ルームから外れた・再接続）の後に、読み込んでいる一覧と件数を取り直す。
   * 行を持たない API なので、差分のカーソルはない（決定 9）。
   */
  function reloadActivity(workspaceId: string): Promise<void> {
    const activity = core.state.activity[workspaceId];
    if (!activity) return Promise.resolve();
    const tasks = Object.keys(activity.lists).map((key) => {
      const { filter, unreadOnly } = parseActivityListKey(key);
      return loadActivityList(workspaceId, filter, unreadOnly, true);
    });
    if (activity.unreadCount !== null) tasks.push(loadActivityUnreadCount(workspaceId));
    return Promise.all(tasks).then(() => undefined);
  }

  /** 既読位置が進んだ。手元の 1 件の未読を求め直し、件数は取り直す（読み込んでいない 1 件もあるため）。 */
  function activityRead(workspaceId: string, recipe: (items: ActivityItem[]) => ActivityItem[]) {
    const activity = core.state.activity[workspaceId];
    if (!activity) return;
    patchActivityItems(workspaceId, (items, key) => {
      const read = recipe(items);
      // 「未読メッセージ」の一覧からは、読んだ 1 件を外す
      return parseActivityListKey(key).unreadOnly ? removeActivity(read, (i) => !i.unread) : read;
    });
    if (activity.unreadCount !== null) void loadActivityUnreadCount(workspaceId);
  }

  function roomReadAdvanced(roomId: string, lastReadUserSeq: number) {
    const workspaceId = core.state.rooms[roomId]?.workspace_id;
    if (workspaceId) activityRead(workspaceId, (items) => applyRoomReadToActivity(items, roomId, lastReadUserSeq));
  }

  /**
   * 届いたメッセージを、通知の規則（notifyReasons）で当てはまる一覧に足す（決定 9）。
   * 手元にある値（ルームの設定・全体の設定・参加中のスレッド）で判断する。ずれは次に取り直したときに直る。
   */
  function receiveActivityMessage(message: Message) {
    const room = core.state.rooms[message.room_id];
    const workspaceId = room?.workspace_id;
    if (!room || !workspaceId || !core.state.activity[workspaceId]) return;
    const thread =
      message.thread_root_id === null
        ? undefined
        : core.state.threadLists[workspaceId]?.list.find((t) => t.root.id === message.thread_root_id);
    const reasons = notifyReasons(
      { message, userId, room, level: core.state.notificationLevels[workspaceId], thread, now: now() },
      { countHere: true },
    );
    if (reasons.length === 0) return;
    const unread = inChannel(message)
      ? message.user_seq > (room.last_read_user_seq ?? 0)
      : thread !== undefined && thread.last_read_thread_seq !== null && (message.thread_seq ?? 0) > thread.last_read_thread_seq;
    const item = messageActivityItem(message, room, reasons, unread);
    patchActivityItems(workspaceId, (items, key) => {
      const { filter, unreadOnly } = parseActivityListKey(key);
      return belongsTo(item, filter, unreadOnly) ? insertActivity(items, item) : items;
    });
    if (unread && !countedActivity.has(message.id)) {
      countedActivity.add(message.id);
      patchActivity(workspaceId, (activity) =>
        activity.unreadCount === null
          ? activity
          : { ...activity, unreadCount: Math.min(MAX_UNREAD_ACTIVITY, activity.unreadCount + 1) },
      );
    }
  }

  /** 編集・削除を一覧の 1 件に当てる。削除されたメッセージ（とそのリアクション）は外す。 */
  function receiveActivityChange(message: Message) {
    const workspaceId = core.state.rooms[message.room_id]?.workspace_id;
    const activity = workspaceId ? core.state.activity[workspaceId] : undefined;
    if (!workspaceId || !activity) return;
    let removedUnread = false;
    patchActivityItems(workspaceId, (items) => {
      if (!items.some((i) => i.message.id === message.id)) return items;
      if (message.deleted_at !== null) {
        removedUnread ||= items.some((i) => i.message.id === message.id && i.unread);
        return removeActivity(items, (i) => i.message.id === message.id);
      }
      return items.map((i) => (i.message.id === message.id ? { ...i, message } : i));
    });
    if (removedUnread && activity.unreadCount !== null) void loadActivityUnreadCount(workspaceId);
  }

  return {
    activityRead,
    patchActivityItems,
    receiveActivityChange,
    receiveActivityMessage,
    reloadActivity,
    roomReadAdvanced,
    actions: {
      /** アクティビティの一覧を取る（ADR 0058）。取ってあれば取り直さない（イベントで最新に保っている）。 */
      loadActivity(workspaceId: string, filter: ActivityFilter, unreadOnly: boolean): Promise<void> {
        return loadActivityList(workspaceId, filter, unreadOnly);
      },

      /** 一覧の続きを取る。続きがない・取得中なら何もしない。 */
      loadMoreActivity(workspaceId: string, filter: ActivityFilter, unreadOnly: boolean): Promise<void> {
        const key = activityListKey(filter, unreadOnly);
        const list = core.state.activity[workspaceId]?.lists[key];
        if (list?.status !== "ready" || list.nextCursor === null || list.loadingMore) return Promise.resolve();
        const before = list.nextCursor;
        return once(`activity-more:${workspaceId}:${key}`, async () => {
          const patchList = (recipe: (list: ActivityListState) => ActivityListState) =>
            patchActivity(workspaceId, (activity) => {
              const current = activity.lists[key];
              return current ? { ...activity, lists: { ...activity.lists, [key]: recipe(current) } } : activity;
            });
          patchList((l) => ({ ...l, loadingMore: true }));
          try {
            const page = await api.listActivity(workspaceId, { filter, unreadOnly, before });
            patchList((l) => ({
              ...l,
              items: page.items.reduce((items, item) => insertActivity(items, item), l.items),
              nextCursor: page.next_cursor,
              loadingMore: false,
            }));
          } catch (err) {
            patchList((l) => ({ ...l, loadingMore: false }));
            console.error("failed to load more activity", err);
          }
        });
      },

      /** 未読のアクティビティの件数（左のメニューのバッジ）を取る。 */
      loadActivityUnreadCount,

      reloadActivity,
    },
  };
}

export type Activity = ReturnType<typeof createActivity>;
