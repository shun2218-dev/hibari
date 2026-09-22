import { applyReadToRoom, newestChannelSeq } from "@/lib/chat/store/messages";

import type { StoreCore } from "./core";
import type { Activity } from "./activity";

/**
 * 既読（開いているルームを、表示しているところまで既読にする）。
 */
export function createRead(
  core: StoreCore,
  { activity }: { activity: Activity },
) {
  const { api, patchRoom, update } = core;
  const { roomReadAdvanced } = activity;

  const readTargets = new Map<string, number>();

  const reading = new Map<string, Promise<void>>();

  // ---- 既読 ----

  async function markRead(roomId: string, seq: number): Promise<void> {
    const read = await api.markRead(roomId, { seq });
    patchRoom(roomId, (room) =>
      applyReadToRoom(room, {
        lastReadSeq: read.last_read_seq,
        lastReadUserSeq: read.last_read_user_seq,
        mentionCount: read.mention_count,
      }),
    );
    roomReadAdvanced(roomId, read.last_read_user_seq);
  }

  /**
   * 既読を頼む。送信中なら、終わった後にいちばん大きい seq でもう 1 回だけ送る（届くたびに 1 本ずつ送らない）。
   * 返す Promise は、頼んだ分を送り終えたら解決する（失敗はログに出して投げない）。
   */
  function requestMarkRead(roomId: string, seq: number): Promise<void> {
    const room = core.state.rooms[roomId];
    if (!room || room.last_read_seq === null || room.last_read_seq >= seq) return Promise.resolve();
    readTargets.set(roomId, Math.max(readTargets.get(roomId) ?? 0, seq));
    let loop = reading.get(roomId);
    if (!loop) {
      loop = (async () => {
        try {
          for (let target = readTargets.get(roomId); target !== undefined; target = readTargets.get(roomId)) {
            readTargets.delete(roomId);
            await markRead(roomId, target);
          }
        } catch (err) {
          readTargets.delete(roomId);
          console.error("failed to mark room read", err);
        } finally {
          reading.delete(roomId);
        }
      })();
      reading.set(roomId, loop);
    }
    return loop;
  }

  return {
    requestMarkRead,
    actions: {
      /**
       * 開いているルームと、その最新を見ているかを知らせる。見始めたら、表示しているところまで既読にする。
       * 「アクセスできません」を出していたルームから離れたら、覚えていたことを忘れる。
       */
      setFocus(focus: { roomId: string; caughtUp: boolean } | null) {
        const previous = core.state.focus;
        if (previous?.roomId === focus?.roomId && previous?.caughtUp === focus?.caughtUp) return;
        update((s) => ({ ...s, focus }));
        if (previous && previous.roomId !== focus?.roomId && core.state.removedRooms[previous.roomId]) {
          // もう一度 URL を開いたら、ほかの読めないルームと同じく 404 で入口に戻す
          update((s) => ({ ...s, removedRooms: { ...s.removedRooms, [previous.roomId]: undefined } }));
        }
        if (focus?.caughtUp) {
          const latestSeq = newestChannelSeq(core.state.timelines[focus.roomId]?.messages ?? []);
          if (latestSeq !== undefined && core.state.timelines[focus.roomId]?.status === "ready") {
            void requestMarkRead(focus.roomId, latestSeq);
          }
        }
      },
    },
  };
}

export type Read = ReturnType<typeof createRead>;
