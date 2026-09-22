import type { MessageAttachment } from "@/lib/api/types.gen";
import type { OutgoingMessage } from "./state";
import { ulid } from "@/lib/ulid";

import type { StoreCore } from "./core";
import type { Timeline } from "./timeline";

/**
 * 送信（ルームごとに 1 本の列で、入力した順に送る。ADR 0027）。
 */
export function createSend(
  core: StoreCore,
  { timeline }: { timeline: Timeline },
) {
  const { api, now, patchOutgoing, sendTimeoutMs, update } = core;
  const { receiveMessage } = timeline;

  // ルームごとの送信の順番（client_msg_id）と、送っている途中のループ
  const sendQueues = new Map<string, string[]>();

  const sendLoops = new Map<string, Promise<void>>();

  // ---- 送信 ----

  /**
   * ルームの送信を 1 件ずつ順に送る。
   *
   * 並行して送ると、後に入力したメッセージが先に採番されることがある（並びは seq で決まる）。
   * 1 件が失敗したら、後ろに並んでいるものも送らずに失敗にする。先に送ると、失敗したものを再送したときに順番が入れ替わるため。
   */
  function runSendQueue(roomId: string): Promise<void> {
    let loop = sendLoops.get(roomId);
    if (loop) return loop;
    loop = (async () => {
      try {
        for (let queue = sendQueues.get(roomId); queue && queue.length > 0; queue = sendQueues.get(roomId)) {
          const item = core.state.outgoing[roomId]?.find((m) => m.clientMsgId === queue[0]);
          // 確定済み（応答より先にイベントが届いた）か、取り消された
          if (!item || item.status !== "pending") {
            queue.shift();
            continue;
          }
          try {
            await sendOne(roomId, item);
            queue.shift();
          } catch (err) {
            failQueue(roomId);
            if (!(err instanceof SendTimeoutError)) console.error("failed to send a message", err);
          }
        }
      } finally {
        sendLoops.delete(roomId);
      }
    })();
    sendLoops.set(roomId, loop);
    return loop;
  }

  async function sendOne(roomId: string, item: OutgoingMessage) {
    const sending = api.sendMessage(roomId, {
      client_msg_id: item.clientMsgId,
      body: item.body,
      ...(item.threadRootId === null ? {} : { thread_root_id: item.threadRootId, also_in_channel: item.alsoInChannel }),
      ...(item.attachments.length === 0 ? {} : { attachment_ids: item.attachments.map((a) => a.id) }),
    });
    // 待ちきれずに失敗にした後で応答が届いても、確定として扱う（同じ client_msg_id の再送は同じメッセージを返す）
    sending.then((message) => receiveMessage(message, true)).catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        sending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new SendTimeoutError()), sendTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function failQueue(roomId: string) {
    const queued = new Set(sendQueues.get(roomId) ?? []);
    sendQueues.delete(roomId);
    patchOutgoing(roomId, (list) =>
      list.some((m) => queued.has(m.clientMsgId) && m.status === "pending")
        ? list.map((m) => (queued.has(m.clientMsgId) && m.status === "pending" ? { ...m, status: "failed" } : m))
        : list,
    );
  }

  function enqueueSend(roomId: string, clientMsgId: string) {
    const queue = sendQueues.get(roomId) ?? [];
    queue.push(clientMsgId);
    sendQueues.set(roomId, queue);
    void runSendQueue(roomId);
  }

  function dropOutgoing(roomId: string) {
    sendQueues.delete(roomId);
    update((s) => (s.outgoing[roomId] ? { ...s, outgoing: { ...s.outgoing, [roomId]: undefined } } : s));
  }

  return {
    dropOutgoing,
    actions: {
      // ---- 送信・編集・削除 ----

      /**
       * メッセージを送る。すぐに送信中として表示し、同じルームの前の送信が終わってから送る（ADR 0027）。
       * 失敗は投げずに、メッセージを failed にする。
       */
      sendMessage(
        roomId: string,
        input: {
          body: string;
          attachments?: MessageAttachment[];
          threadRootId?: string | null;
          /** 返信をチャンネルにも出す（ADR 0039）。返信でないときに渡しても無視する（サーバーは 422 を返すため）。 */
          alsoInChannel?: boolean;
        },
      ) {
        const threadRootId = input.threadRootId ?? null;
        const item: OutgoingMessage = {
          clientMsgId: ulid(now()),
          body: input.body,
          threadRootId,
          alsoInChannel: threadRootId !== null && (input.alsoInChannel ?? false),
          attachments: input.attachments ?? [],
          status: "pending",
          createdAt: new Date(now()).toISOString(),
        };
        patchOutgoing(roomId, (list) => [...list, item]);
        enqueueSend(roomId, item.clientMsgId);
      },

      /** 失敗したメッセージを、同じ client_msg_id で送り直す。 */
      retryMessage(roomId: string, clientMsgId: string) {
        const item = core.state.outgoing[roomId]?.find((m) => m.clientMsgId === clientMsgId);
        if (item?.status !== "failed") return;
        patchOutgoing(roomId, (list) =>
          list.map((m) => (m.clientMsgId === clientMsgId ? { ...m, status: "pending" } : m)),
        );
        enqueueSend(roomId, clientMsgId);
      },

      /**
       * 失敗したメッセージを表示から消す。待ちきれずに失敗にしたものは実は届いていることがあり、そのときは後で履歴に現れる。
       */
      discardMessage(roomId: string, clientMsgId: string) {
        patchOutgoing(roomId, (list) =>
          list.some((m) => m.clientMsgId === clientMsgId && m.status === "failed")
            ? list.filter((m) => m.clientMsgId !== clientMsgId)
            : list,
        );
      },
    },
  };
}

export type Send = ReturnType<typeof createSend>;

export const SEND_TIMEOUT_MS = 10_000;

export class SendTimeoutError extends Error {
  constructor() {
    super("sending a message timed out");
  }
}
