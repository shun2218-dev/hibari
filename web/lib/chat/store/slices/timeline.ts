import type { Message, Room } from "@/lib/api/types.gen";
import {
  advanceCursor,
  applyMessageToRoom,
  inChannel,
  mergeIntoWindow,
  mergeMessages,
  newestChannelSeq,
} from "@/lib/chat/store/messages";
import { statusOf } from "@/lib/chat/store/state";

import type { StoreCore } from "./core";
import type { Read } from "./read";
import type { Pins } from "./pins";
import type { Threads } from "./threads";
import type { Typing } from "./typing";

/**
 * タイムライン（REST で取った窓に、届いたメッセージを重ねる。取りこぼしは change_seq で取り直す。ADR 0014 / 0026）。
 */
export function createTimeline(
  core: StoreCore,
  { read, pins, threads, typing }: { read: Read; pins: Pins; threads: Threads; typing: Typing },
) {
  const { api, once, patchOutgoing, patchRoom, patchRoomList, patchTimeline, putRoom, update, userId } = core;
  const { requestMarkRead } = read;
  const { absorbPins, loadPins } = pins;
  const { absorbThreadMessages } = threads;
  const { removeTyping } = typing;

  // 同期中にもう一度頼まれたら、終わった後にもう 1 回だけ回す（その間に進んだカーソルから取り直す）
  const syncing = new Map<string, { again: boolean; promise: Promise<void> }>();

  // ---- タイムライン ----

  /**
   * タイムラインにメッセージを足した後の、「ここから未読」と既読の扱い。
   *
   * - 最新を見ている（または足されたのが自分のメッセージだけ）なら、区切りがまだ出ていないときだけ区切りを後ろに送り、既読にする
   * - 見ていないなら、区切りを消していた場合はそれまでの最新の後ろに出し直す。既読にはしない
   */
  function afterNewMessages(roomId: string, previousNewest: number | undefined, added: readonly Message[]) {
    const timeline = core.state.timelines[roomId];
    const room = core.state.rooms[roomId];
    const newest = timeline ? newestChannelSeq(timeline.messages) : undefined;
    if (!timeline || timeline.status !== "ready" || newest === undefined || previousNewest === undefined) return;
    if (newest <= previousNewest || !room || room.last_read_seq === null) return;

    const seen =
      (core.state.focus?.roomId === roomId && core.state.focus.caughtUp) ||
      added.filter((m) => m.seq > previousNewest && inChannel(m)).every((m) => m.sender.id === userId);
    if (seen) {
      if (timeline.unreadAfterSeq !== null && timeline.unreadAfterSeq >= previousNewest) {
        patchTimeline(roomId, { unreadAfterSeq: newest });
      }
      if (core.state.focus?.roomId === roomId) void requestMarkRead(roomId, newest);
    } else if (timeline.unreadAfterSeq === null) {
      patchTimeline(roomId, { unreadAfterSeq: previousNewest });
    }
  }

  /** 差分の取得を 1 回行う。遅れすぎていたら（1 ページで追いつかない）、最新のページで置き換える。 */
  async function syncOnce(roomId: string) {
    const timeline = core.state.timelines[roomId];
    if (!timeline || timeline.status !== "ready") return;
    const previousNewest = newestChannelSeq(timeline.messages);

    const page = await api.listChanges(roomId, timeline.changeSeq);
    absorbThreadMessages(page.messages, false);
    absorbPins(page.messages);
    for (const message of page.messages) reflectChangeInRoom(message);
    if (!page.has_more) {
      update((s) => {
        const current = s.timelines[roomId];
        if (!current) return s;
        const messages = mergeIntoWindow(current.messages, current, page.messages);
        // last_change_seq はメッセージを読む前の値なので、最後のページのときだけカーソルに使ってよい（ADR 0014）
        const changeSeq = advanceCursor(Math.max(current.changeSeq, page.last_change_seq), messages);
        return { ...s, timelines: { ...s.timelines, [roomId]: { ...current, messages, changeSeq } } };
      });
      afterNewMessages(roomId, previousNewest, page.messages);
      return;
    }

    // 手元との間が 1 ページ（100 件の変更）を超えた。全部たどると、読み込んでいない範囲の変更まで取ることになるので、
    // 最新のページを読み直す。その間に届いたイベントは残す。ピン留めの一覧も、たどらなかった変更の分を取り直す
    if (core.state.pins[roomId]) void loadPins(roomId);
    const latest = await api.listMessages(roomId);
    update((s) => {
      const current = s.timelines[roomId];
      if (!current) return s;
      const base = mergeMessages([], latest.messages);
      const arrived = current.messages.filter((m) => m.change_seq > latest.last_change_seq);
      const messages = mergeIntoWindow(base, { hasOlder: latest.has_more, hasNewer: false }, arrived);
      return {
        ...s,
        timelines: {
          ...s.timelines,
          [roomId]: {
            ...current,
            messages,
            hasOlder: latest.has_more,
            // 最新のページで置き換えたので、新しい側はつながっている
            hasNewer: false,
            changeSeq: advanceCursor(latest.last_change_seq, messages),
          },
        },
      };
    });
    afterNewMessages(roomId, previousNewest, latest.messages);
  }

  function syncTimeline(roomId: string): Promise<void> {
    const running = syncing.get(roomId);
    if (running) {
      running.again = true;
      return running.promise;
    }
    const entry = { again: false, promise: Promise.resolve() };
    entry.promise = (async () => {
      try {
        do {
          entry.again = false;
          await syncOnce(roomId);
        } while (entry.again);
      } catch (err) {
        if (statusOf(err) === "not_found") patchTimeline(roomId, { status: "not_found" });
        else console.error("failed to sync messages", err);
      } finally {
        syncing.delete(roomId);
      }
    })();
    syncing.set(roomId, entry);
    return entry.promise;
  }

  /**
   * 既存のメッセージの編集・削除を、サイドバーの最後の 1 行に反映する。イベントでも差分の取得でも同じように通す。
   * 最後のメッセージが削除されたら、ひとつ前（削除されていない最後の行）をサーバーに聞く（ADR 0038）。
   */
  function reflectChangeInRoom(message: Message) {
    const before = core.state.rooms[message.room_id];
    patchRoom(message.room_id, (room) => applyMessageToRoom(room, message, userId, false));
    if (before?.last_message?.id === message.id && message.deleted_at !== null) void refreshRoom(message.room_id);
  }

  /** ルームの情報（メンバー数・参加の状態）を取り直す。 */
  function refreshRoom(roomId: string): Promise<void> {
    return once(`room-info:${roomId}`, async () => {
      try {
        putRoom(await api.getRoom(roomId));
      } catch (err) {
        if (statusOf(err) === "error") console.error("failed to refresh room", err);
      }
    });
  }

  // ---- イベント ----

  function receiveMessage(message: Message, created: boolean) {
    const roomId = message.room_id;
    // 自分の送信が確定した（送信の応答か、message.created のどちらか先に届いた方）。楽観的な表示を外す
    if (created && message.sender.id === userId) {
      patchOutgoing(roomId, (list) =>
        list.some((m) => m.clientMsgId === message.client_msg_id)
          ? list.filter((m) => m.clientMsgId !== message.client_msg_id)
          : list,
      );
    }
    const before = core.state.rooms[roomId];
    if (created) patchRoom(roomId, (room) => applyMessageToRoom(room, message, userId, true));
    else reflectChangeInRoom(message);
    const after = core.state.rooms[roomId];
    // 新しいメッセージのルームを一覧の先頭に移す（最後のメッセージが新しい順）
    if (created && before && after && after !== before) {
      patchRoomList(after.workspace_id, (ids) =>
        ids[0] === roomId || !ids.includes(roomId) ? ids : [roomId, ...ids.filter((id) => id !== roomId)],
      );
    }
    if (created && message.thread_root_id === null) removeTyping(roomId, message.sender.id);
    absorbThreadMessages([message], created);
    absorbPins([message]);

    const timeline = core.state.timelines[roomId];
    if (!timeline) return;
    if (timeline.status === "loading") {
      // 開いている途中に届いた。取得の結果と合わせるので、範囲を決めずに持っておく
      patchTimeline(roomId, { messages: mergeMessages(timeline.messages, [message]) });
      return;
    }
    if (timeline.status !== "ready" || message.change_seq <= timeline.changeSeq) return;

    const previousNewest = newestChannelSeq(timeline.messages);
    const messages = mergeIntoWindow(timeline.messages, timeline, [message]);
    // 読み込んでいない範囲の変更は足さないが、番号が続いていれば反映したことにしてよい（表示するものがない）
    const next = message.change_seq === timeline.changeSeq + 1 ? message.change_seq : timeline.changeSeq;
    const changeSeq = advanceCursor(next, messages);
    patchTimeline(roomId, { messages, changeSeq });
    afterNewMessages(roomId, previousNewest, [message]);
    // 間の変更が届いていない（落ちたか、順序が入れ替わった）。差分を取り直す
    if (message.change_seq > timeline.changeSeq + 1 && changeSeq < message.change_seq) void syncTimeline(roomId);
  }

  /**
   * ルームを開く。ルームの情報（メンバー数・既読位置）を取り直し、表示したいちばん新しいメッセージまで読んだことにする。
   *
   * 前に開いて手元に残っているなら、差分（after_change_seq）だけを取る。なければ最新のページを取る（ADR 0026）。
   * 飛ぶ（jumpToMessage）よりも先に終わらせたいので、返すオブジェクトの外に置いて中からも呼べるようにしてある。
   */
  function openRoom(roomId: string): Promise<void> {
    return once(`room:${roomId}`, async () => {
      const cached = core.state.timelines[roomId];
      let room: Room;
      if (cached?.status === "ready") {
        try {
          room = await api.getRoom(roomId);
        } catch (err) {
          patchTimeline(roomId, { status: statusOf(err) });
          if (statusOf(err) === "error") console.error("failed to open room", err);
          return;
        }
        putRoom(room);
        patchTimeline(roomId, { unreadAfterSeq: room.last_read_seq, unreadAtOpen: room.unread_count });
        await syncTimeline(roomId);
      } else {
        update((s) => ({
          ...s,
          timelines: {
            ...s.timelines,
            [roomId]: {
              status: "loading",
              // 開いている途中に届いたイベントは、ここに溜まっている
              messages: s.timelines[roomId]?.status === "loading" ? s.timelines[roomId].messages : [],
              hasOlder: false,
              loadingOlder: false,
              hasNewer: false,
              loadingNewer: false,
              unreadAfterSeq: null,
              unreadAtOpen: 0,
              changeSeq: 0,
            },
          },
        }));
        try {
          const [fetchedRoom, page] = await Promise.all([api.getRoom(roomId), api.listMessages(roomId)]);
          room = fetchedRoom;
          putRoom(room);
          update((s) => {
            const arrived = (s.timelines[roomId]?.messages ?? []).filter((m) => m.change_seq > page.last_change_seq);
            const messages = mergeIntoWindow(
              mergeMessages([], page.messages),
              { hasOlder: page.has_more, hasNewer: false },
              arrived,
            );
            return {
              ...s,
              timelines: {
                ...s.timelines,
                [roomId]: {
                  status: "ready",
                  messages,
                  hasOlder: page.has_more,
                  loadingOlder: false,
                  hasNewer: false,
                  loadingNewer: false,
                  unreadAfterSeq: room.last_read_seq,
                  unreadAtOpen: room.unread_count,
                  changeSeq: advanceCursor(page.last_change_seq, messages),
                },
              },
            };
          });
        } catch (err) {
          patchTimeline(roomId, { status: statusOf(err) });
          if (statusOf(err) === "error") console.error("failed to open room", err);
          return;
        }
      }

      // 画面に出したいちばん新しいメッセージまで読んだことにする。ルームの last_message_seq を使わないのは、
      // 取得の間に届いたメッセージを、見せる前に既読にしないため。メンバーでなければ既読位置はない
      const latestSeq = newestChannelSeq(core.state.timelines[roomId]?.messages ?? []);
      if (latestSeq !== undefined) await requestMarkRead(roomId, latestSeq);
    });
  }

  return {
    openRoom,
    receiveMessage,
    refreshRoom,
    syncTimeline,
    actions: {
      openRoom,

      syncTimeline,
    },
  };
}

export type Timeline = ReturnType<typeof createTimeline>;
