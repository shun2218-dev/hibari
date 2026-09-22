
import type { Message, UserProfile } from "@/lib/api/types.gen";
import { applyThreadReadToActivity } from "@/lib/chat/rules/activity-feed";
import { statusOf, type ThreadState, TYPING_TTL_MS } from "./state";
import {
  applyReplyToThreads,
  applyRootToThreads,
  applyThreadNotify,
  applyThreadRead,
  mergeReplies,
  mergeRepliesIntoWindow,
} from "@/lib/chat/rules/threads";

import type { StoreCore } from "./core";
import type { Activity } from "./activity";

/**
 * スレッド（ADR 0036）。
 */
export function createThreads(
  core: StoreCore,
  { activity }: { activity: Activity },
) {
  const { api, inflight, now, once, patchThread, patchThreadList, typingTimers, update, userId } = core;
  const { activityRead } = activity;

  /** 自分の既読位置を進める（スレッドとワークスペースの一覧の両方）。 */
  function advanceThreadRead(roomId: string, rootId: string, lastReadThreadSeq: number) {
    patchThread(rootId, (t) =>
      t.lastReadThreadSeq === null || t.lastReadThreadSeq >= lastReadThreadSeq
        ? t
        : { ...t, lastReadThreadSeq: lastReadThreadSeq },
    );
    const workspaceId = core.state.rooms[roomId]?.workspace_id;
    if (workspaceId) patchThreadList(workspaceId, (list) => applyThreadRead(list, rootId, lastReadThreadSeq));
    if (workspaceId) activityRead(workspaceId, (items) => applyThreadReadToActivity(items, rootId, lastReadThreadSeq));
  }

  function absorbThreadMessages(messages: readonly Message[], created: boolean) {
    for (const message of messages) {
      const rootId = message.thread_root_id;
      if (rootId !== null) {
        patchThread(rootId, (t) => {
          const replies = mergeRepliesIntoWindow(t.replies, t, [message]);
          return replies === t.replies ? t : { ...t, replies };
        });
        if (created) {
          const workspaceId = core.state.rooms[message.room_id]?.workspace_id;
          if (workspaceId) patchThreadList(workspaceId, (list) => applyReplyToThreads(list, message, userId));
        }
        if (created && message.sender.id === userId && message.thread_seq !== null) {
          advanceThreadRead(message.room_id, rootId, message.thread_seq);
        }
        if (created) removeThreadTyping(rootId, message.sender.id);
      }
      if (message.thread !== null) {
        patchThread(message.id, (t) =>
          t.root && t.root.change_seq > message.change_seq ? t : { ...t, root: message },
        );
        const workspaceId = core.state.rooms[message.room_id]?.workspace_id;
        if (workspaceId) patchThreadList(workspaceId, (list) => applyRootToThreads(list, message));
      } else {
        // 親の削除（tombstone）や編集。返信がまだないメッセージは親として持っていないので、開いていたときだけ書き換える
        patchThread(message.id, (t) =>
          t.root && t.root.change_seq > message.change_seq ? t : { ...t, root: message },
        );
      }
    }
  }

  function removeThreadTyping(rootId: string, typingUserId: string) {
    const key = `thread:${rootId}:${typingUserId}`;
    clearTimeout(typingTimers.get(key));
    typingTimers.delete(key);
    update((s) => {
      const current = s.threadTyping[rootId];
      if (!current?.some((t) => t.user.id === typingUserId)) return s;
      const rest = current.filter((t) => t.user.id !== typingUserId);
      return { ...s, threadTyping: { ...s.threadTyping, [rootId]: rest.length > 0 ? rest : undefined } };
    });
  }

  function receiveThreadTyping(rootId: string, user: UserProfile) {
    if (user.id === userId) return;
    const key = `thread:${rootId}:${user.id}`;
    clearTimeout(typingTimers.get(key));
    typingTimers.set(key, setTimeout(() => removeThreadTyping(rootId, user.id), TYPING_TTL_MS));
    update((s) => {
      const others = (s.threadTyping[rootId] ?? []).filter((t) => t.user.id !== user.id);
      return {
        ...s,
        threadTyping: { ...s.threadTyping, [rootId]: [...others, { user, expiresAt: now() + TYPING_TTL_MS }] },
      };
    });
  }

  function loadThreads(workspaceId: string): Promise<void> {
    return once(`threads:${workspaceId}`, async () => {
      update((s) =>
        s.threadLists[workspaceId]
          ? s
          : { ...s, threadLists: { ...s.threadLists, [workspaceId]: { status: "loading", list: [] } } },
      );
      try {
        const list = await api.listAllThreads(workspaceId);
        update((s) => ({ ...s, threadLists: { ...s.threadLists, [workspaceId]: { status: "ready", list } } }));
      } catch (err) {
        update((s) => ({
          ...s,
          threadLists: {
            ...s.threadLists,
            [workspaceId]: { status: statusOf(err), list: s.threadLists[workspaceId]?.list ?? [] },
          },
        }));
        if (statusOf(err) === "error") console.error("failed to load threads", err);
      }
    });
  }

  /** スレッドのパネルを開いた。まだ取っていなければ最新のページを取る（飛ぶ処理の中からも呼ぶ）。 */
  function loadThreadIfNeeded(roomId: string, rootId: string): Promise<void> {
    const current = core.state.threads[rootId];
    if (current?.status === "ready" && current.roomId === roomId) return Promise.resolve();
    return loadThread(roomId, rootId);
  }

  /** 取得中のものがあれば、それが終わってからもう 1 回取る（reloadRooms と同じ理由）。 */
  async function reloadThreads(workspaceId: string): Promise<void> {
    await inflight.get(`threads:${workspaceId}`);
    return loadThreads(workspaceId);
  }

  /**
   * スレッドの最新のページを取る。取得の間に届いた返信は残す（openRoom と同じ）。
   * 取り直し（再接続）では、取れるまで手元の状態をそのまま見せる。既読位置も後退させない。
   */
  function loadThread(roomId: string, rootId: string): Promise<void> {
    return once(`thread:${rootId}`, async () => {
      update((s) => {
        const current = s.threads[rootId];
        if (current && current.roomId === roomId) return s;
        const thread: ThreadState = {
          status: "loading",
          roomId,
          root: null,
          replies: [],
          hasOlder: false,
          loadingOlder: false,
          hasNewer: false,
          loadingNewer: false,
          lastReadThreadSeq: null,
        };
        return { ...s, threads: { ...s.threads, [rootId]: thread } };
      });
      try {
        const page = await api.listThreadMessages(roomId, rootId);
        update((s) => {
          const current = s.threads[rootId];
          const arrived = (current?.replies ?? []).filter((m) => m.change_seq > page.last_change_seq);
          const replies = mergeRepliesIntoWindow(
            mergeReplies([], page.messages),
            { hasOlder: page.has_more, hasNewer: false },
            arrived,
          );
          const root = current?.root && current.root.change_seq > page.root.change_seq ? current.root : page.root;
          const lastRead =
            page.last_read_thread_seq === null
              ? null
              : Math.max(page.last_read_thread_seq, current?.lastReadThreadSeq ?? 0);
          return {
            ...s,
            threads: {
              ...s.threads,
              [rootId]: {
                status: "ready",
                roomId,
                root,
                replies,
                hasOlder: page.has_more,
                loadingOlder: false,
                hasNewer: false,
                loadingNewer: false,
                lastReadThreadSeq: lastRead,
              },
            },
          };
        });
      } catch (err) {
        patchThread(rootId, (t) => ({ ...t, status: statusOf(err) }));
        if (statusOf(err) === "error") console.error("failed to load thread", err);
      }
    });
  }

  return {
    absorbThreadMessages,
    advanceThreadRead,
    receiveThreadTyping,
    reloadThreads,
    actions: {
      // ---- スレッド（ADR 0036）----

      loadThreads,

      reloadThreads,

      openThread: loadThreadIfNeeded,

      /** 再接続の後に取り直す。取得の間に届いた返信は残す。 */
      async reloadThread(roomId: string, rootId: string): Promise<void> {
        await inflight.get(`thread:${rootId}`);
        return loadThread(roomId, rootId);
      },

      /**
       * スレッドのパネルを開いて、指定した返信の前後を読み込む（ADR 0042）。
       * 見つからなければ最新のページのままにする（チャンネル側と同じで、理由は区別しない）。
       */
      async jumpToThreadMessage(roomId: string, rootId: string, messageId: string): Promise<{ found: boolean }> {
        await loadThreadIfNeeded(roomId, rootId);
        const thread = core.state.threads[rootId];
        if (!thread || thread.status !== "ready") return { found: false };
        try {
          const page = await api.listThreadMessages(roomId, rootId, { aroundMessageId: messageId });
          patchThread(rootId, (t) => ({
            ...t,
            replies: mergeReplies([], page.messages),
            hasOlder: page.has_more,
            loadingOlder: false,
            hasNewer: page.has_more_after,
            loadingNewer: false,
          }));
          return { found: page.around !== null };
        } catch (err) {
          console.error("failed to jump to a reply", err);
          return { found: false };
        }
      },

      /** 飛んだ先から新しい方へ読み足す（ADR 0042）。読み切ると、届いた返信がまた末尾に並ぶようになる。 */
      async loadNewerThread(rootId: string): Promise<void> {
        const thread = core.state.threads[rootId];
        if (!thread || thread.status !== "ready" || !thread.hasNewer || thread.loadingNewer) return;
        const newest = thread.replies.at(-1);
        if (!newest) return;
        patchThread(rootId, (t) => ({ ...t, loadingNewer: true }));
        try {
          const page = await api.listThreadMessages(thread.roomId, rootId, { afterSeq: newest.seq });
          patchThread(rootId, (t) => ({
            ...t,
            replies: mergeReplies(t.replies, page.messages),
            hasNewer: page.has_more,
            loadingNewer: false,
          }));
        } catch (err) {
          patchThread(rootId, (t) => ({ ...t, loadingNewer: false }));
          console.error("failed to load newer replies", err);
        }
      },

      /** いちばん古い返信より前のページを取る。取得中やもうないときは何もしない。 */
      async loadOlderThread(rootId: string): Promise<void> {
        const thread = core.state.threads[rootId];
        if (!thread || thread.status !== "ready" || !thread.hasOlder || thread.loadingOlder) return;
        const oldest = thread.replies[0];
        if (!oldest) return;
        patchThread(rootId, (t) => ({ ...t, loadingOlder: true }));
        try {
          const page = await api.listThreadMessages(thread.roomId, rootId, { beforeSeq: oldest.seq });
          patchThread(rootId, (t) => ({
            ...t,
            replies: mergeReplies(t.replies, page.messages),
            hasOlder: page.has_more,
            loadingOlder: false,
          }));
        } catch (err) {
          patchThread(rootId, (t) => ({ ...t, loadingOlder: false }));
          console.error("failed to load older replies", err);
        }
      },

      /**
       * 開いているスレッドを、表示している最新の返信まで既読にする。参加していない・未読がないときは何もしない。
       * 失敗はログに出して投げない（次に返信が届いたときにもう一度試す）。
       */
      markThreadRead(rootId: string): Promise<void> {
        const thread = core.state.threads[rootId];
        const newest = thread?.replies.at(-1);
        if (!thread || thread.status !== "ready" || !newest || thread.lastReadThreadSeq === null) return Promise.resolve();
        // サーバーは seq 以下で最後の返信の thread_seq まで進める。表示している最新の返信まで読んであれば送らない
        if ((newest.thread_seq ?? 0) <= thread.lastReadThreadSeq) return Promise.resolve();
        return once(`thread-read:${rootId}`, async () => {
          try {
            const read = await api.markThreadRead(thread.roomId, rootId, { seq: newest.seq });
            if (read.following) advanceThreadRead(thread.roomId, rootId, read.last_read_thread_seq);
          } catch (err) {
            console.error("failed to mark thread read", err);
          }
        });
      },

      setThreadFocus(focus: { roomId: string; rootId: string } | null) {
        update((s) =>
          s.threadFocus?.rootId === focus?.rootId && s.threadFocus?.roomId === focus?.roomId ? s : { ...s, threadFocus: focus },
        );
      },

      /**
       * スレッドの返信の通知を切り替える（ADR 0056）。手元の一覧で先に反映し、失敗したら元に戻して ApiError を投げる。
       * 参加していないスレッドを true にしたとき（フォロー）は、応答の後に一覧を取り直して加える（親の本文などは一覧の API にしかない）。
       */
      async setThreadNotifications(workspaceId: string, roomId: string, rootId: string, notify: boolean): Promise<void> {
        const before = core.state.threadLists[workspaceId]?.list.find((t) => t.root.id === rootId)?.notify_replies;
        patchThreadList(workspaceId, (list) => applyThreadNotify(list, rootId, notify));
        try {
          await api.setThreadNotifications(roomId, rootId, notify);
        } catch (error) {
          if (before !== undefined) patchThreadList(workspaceId, (list) => applyThreadNotify(list, rootId, before));
          throw error;
        }
        if (notify && before === undefined) await reloadThreads(workspaceId);
      },
    },
  };
}

export type Threads = ReturnType<typeof createThreads>;
