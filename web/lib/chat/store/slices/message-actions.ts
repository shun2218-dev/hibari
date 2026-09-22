
import { toggleReaction } from "@/lib/chat/store/reactions";

import type { StoreCore } from "./core";
import type { Timeline } from "./timeline";

/**
 * メッセージへの操作（編集・リアクション・ピン留め・削除）。
 */
export function createMessageActions(
  core: StoreCore,
  { timeline }: { timeline: Timeline },
) {
  const { api, findMessage, patchMessageEverywhere, userId } = core;
  const { receiveMessage, syncTimeline } = timeline;



  return {
    actions: {
      /** 本文を編集する。失敗したら ApiError を投げる。 */
      async editMessage(roomId: string, messageId: string, body: string): Promise<void> {
        receiveMessage(await api.editMessage(roomId, messageId, { body }), false);
      },

      /**
       * 絵文字のリアクションを付け外しする（ADR 0044）。押すたびに反転する。
       *
       * 手元で先に反映してから送り、応答（更新後のメッセージ）で確定させる。失敗したら元に戻す。
       * 送信（ADR 0027）と違ってキューに並べないのは、リアクションは順番に意味がなく、
       * 主キーで冪等だから。連打しても最後の状態に落ち着く。
       */
      async toggleReaction(roomId: string, messageId: string, emoji: string): Promise<void> {
        const before = findMessage(roomId, messageId);
        if (!before) return;
        const add = !before.reactions.some((r) => r.emoji === emoji && r.me);
        patchMessageEverywhere(roomId, messageId, (m) => ({
          ...m,
          reactions: toggleReaction(m.reactions, emoji, userId, add),
        }));
        try {
          const updated = add
            ? await api.addReaction(roomId, messageId, emoji)
            : await api.removeReaction(roomId, messageId, emoji);
          receiveMessage(updated, false);
        } catch (error) {
          // 戻すのは、その間に何も届いていないときだけ。届いていればサーバーの値の方が新しい
          patchMessageEverywhere(roomId, messageId, (m) =>
            m.change_seq === before.change_seq ? { ...m, reactions: before.reactions } : m,
          );
          throw error;
        }
      },

      /**
       * ピン留めを付け外しする（ADR 0054）。押すたびに反転する。
       *
       * 楽観的更新はしない。付けたときにチャンネルのログ（システムメッセージ）が一緒にできるので、
       * 手元で先に付けても、ログはサーバーの応答を待つことになる（見た目が 2 段に分かれる）。応答（更新後のメッセージ）で確定させる。
       */
      async togglePin(roomId: string, messageId: string): Promise<void> {
        const message = findMessage(roomId, messageId) ?? core.state.pins[roomId]?.messages.find((m) => m.id === messageId);
        if (!message) return;
        const updated =
          message.pinned === null ? await api.pinMessage(roomId, messageId) : await api.unpinMessage(roomId, messageId);
        receiveMessage(updated, false);
      },

      /**
       * 添付ファイルだけを削除する（ADR 0045）。
       *
       * 取り消せない操作なので、リアクションと違って**楽観的更新はしない**（手元で先に消すと、
       * 失敗したときに「消えたのに戻ってきた」が起きる）。応答（更新後のメッセージ）で確定させる。
       * 最後の 1 件で本文も空だったときは tombstone が返り、メッセージごと消える（決定 8）。
       */
      async deleteAttachment(roomId: string, messageId: string, attachmentId: string): Promise<void> {
        receiveMessage(await api.deleteMessageAttachment(roomId, messageId, attachmentId), false);
      },

      /**
       * メッセージを削除する。応答にメッセージがないので、差分を取って反映する（WebSocket のイベントが先に届いていれば何も起きない）。
       * 失敗したら ApiError を投げる。
       */
      async deleteMessage(roomId: string, messageId: string): Promise<void> {
        await api.deleteMessage(roomId, messageId);
        await syncTimeline(roomId);
      },
    },
  };
}

export type MessageActions = ReturnType<typeof createMessageActions>;
