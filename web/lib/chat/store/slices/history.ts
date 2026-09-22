import type { MessageList } from "@/lib/api/types.gen";
import { advanceCursor, mergeMessages } from "@/lib/chat/store/messages";

import type { StoreCore } from "./core";
import type { Timeline } from "./timeline";

/**
 * 履歴の読み込み（前後のページと、メッセージへ飛ぶ。ADR 0042）。
 */
export function createHistory(
  core: StoreCore,
  { timeline }: { timeline: Timeline },
) {
  const { api, inflight, patchTimeline, update } = core;
  const { openRoom, syncTimeline } = timeline;

  /**
   * タイムラインの窓を、取ってきたページで置き換える（ADR 0042 の「飛ぶ」）。
   * 前後のどちら側が開いているかはページが持っているので、手元の並びは捨ててよい。
   */
  function replaceWindow(roomId: string, page: MessageList) {
    update((s) => {
      const current = s.timelines[roomId];
      if (!current) return s;
      const messages = mergeMessages([], page.messages);
      return {
        ...s,
        timelines: {
          ...s.timelines,
          [roomId]: {
            ...current,
            status: "ready" as const,
            messages,
            hasOlder: page.has_more,
            loadingOlder: false,
            hasNewer: page.has_more_after,
            loadingNewer: false,
            changeSeq: advanceCursor(Math.max(current.changeSeq, page.last_change_seq), messages),
          },
        },
      };
    });
  }

  return {
    actions: {
      /**
       * 指定したメッセージの前後を読み込む（ADR 0042）。パーマリンクを開いたとき、カードや一覧を押したときに使う。
       *
       * 見つかったかどうかを返す。見つからないときサーバーは最新のページを `around: null` で返すので、
       * 「ない・読めない・削除済み」を区別しない（ADR 0040 と同じ方針）。呼ぶ側は知らせを 1 行出すだけにする。
       * `threadRootId` が入っていれば、対象はスレッドの返信なので、呼ぶ側はパネルを開く。
       */
      async jumpToMessage(roomId: string, messageId: string): Promise<{ found: boolean; threadRootId: string | null }> {
        // 開く処理と競争させない（どちらも同じ窓を置き換えるため）。まだ開いていなければ、先に開く
        await inflight.get(`room:${roomId}`);
        if (core.state.timelines[roomId]?.status !== "ready") await openRoom(roomId);
        if (core.state.timelines[roomId]?.status !== "ready") return { found: false, threadRootId: null };
        try {
          const page = await api.listMessages(roomId, { aroundMessageId: messageId });
          replaceWindow(roomId, page);
          return { found: page.around !== null, threadRootId: page.around?.thread_root_id ?? null };
        } catch (err) {
          console.error("failed to jump to a message", err);
          return { found: false, threadRootId: null };
        }
      },

      /**
       * 最初の未読から読み直す（ADR 0042）。専用の API は作らず、`after_seq = 開いた時点の last_read_seq` を使う。
       * 未読の位置がもう画面にあるとき（バーを出していないとき）は呼ばれない。
       */
      async jumpToUnread(roomId: string): Promise<void> {
        const timeline = core.state.timelines[roomId];
        const afterSeq = timeline?.unreadAfterSeq;
        if (!timeline || timeline.status !== "ready" || afterSeq === null || afterSeq === undefined) return;
        try {
          const page = await api.listMessages(roomId, { afterSeq });
          replaceWindow(roomId, { ...page, has_more: afterSeq > 0, has_more_after: page.has_more });
        } catch (err) {
          console.error("failed to jump to the first unread message", err);
        }
      },

      /**
       * 飛んだ先から新しい方へ読み足す（ADR 0042）。読み切ると hasNewer が false になり、
       * 届いたメッセージがまた末尾に並ぶようになる。
       */
      async loadNewer(roomId: string): Promise<void> {
        const timeline = core.state.timelines[roomId];
        if (!timeline || timeline.status !== "ready" || !timeline.hasNewer || timeline.loadingNewer) return;
        const newest = timeline.messages.at(-1);
        if (!newest) return;

        patchTimeline(roomId, { loadingNewer: true });
        try {
          const page = await api.listMessages(roomId, { afterSeq: newest.seq });
          update((s) => {
            const current = s.timelines[roomId];
            if (!current) return s;
            const messages = mergeMessages(current.messages, page.messages);
            return {
              ...s,
              timelines: {
                ...s.timelines,
                [roomId]: {
                  ...current,
                  messages,
                  hasNewer: page.has_more,
                  loadingNewer: false,
                  changeSeq: advanceCursor(current.changeSeq, messages),
                },
              },
            };
          });
          // 最新につながったら、その間に落ちた変更を取り直す
          if (!page.has_more) void syncTimeline(roomId);
        } catch (err) {
          patchTimeline(roomId, { loadingNewer: false });
          console.error("failed to load newer messages", err);
        }
      },

      /** いちばん古いメッセージより前のページを取る。取得中やもうないときは何もしない。 */
      async loadOlder(roomId: string): Promise<void> {
        const timeline = core.state.timelines[roomId];
        if (!timeline || timeline.status !== "ready" || !timeline.hasOlder || timeline.loadingOlder) return;
        const oldest = timeline.messages[0];
        if (!oldest) return;

        patchTimeline(roomId, { loadingOlder: true });
        try {
          const page = await api.listMessages(roomId, { beforeSeq: oldest.seq });
          update((s) => {
            const current = s.timelines[roomId];
            if (!current) return s;
            return {
              ...s,
              timelines: {
                ...s.timelines,
                [roomId]: {
                  ...current,
                  messages: mergeMessages(current.messages, page.messages),
                  hasOlder: page.has_more,
                  loadingOlder: false,
                },
              },
            };
          });
        } catch (err) {
          // hasOlder は残すので、次にいちばん上までスクロールしたときにもう一度試す
          patchTimeline(roomId, { loadingOlder: false });
          console.error("failed to load older messages", err);
        }
      },

      /** 「すべて既読にする」。見ている間に既読にしてあるので、区切りを消すだけ。 */
      dismissUnread(roomId: string) {
        patchTimeline(roomId, { unreadAfterSeq: null });
      },
    },
  };
}

export type History = ReturnType<typeof createHistory>;
