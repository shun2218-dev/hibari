import type { Message } from "@/lib/api/types.gen";
import { applyPinnedMessages } from "@/lib/chat/store/pins";
import { statusOf } from "@/lib/chat/store/state";

import type { StoreCore } from "./core";

/**
 * ピン留め（ADR 0054）。
 */
export function createPins(
  core: StoreCore,
) {
  const { api, once, update } = core;

  /**
   * 届いたメッセージ（イベント・差分・送信の応答）を、スレッドに反映する。
   * - 返信: 開いたことのあるスレッドに足す。自分の返信なら、サーバーが自分の既読位置も進めている
   * - 親（thread を持つ）: スレッドの親と、参加中の一覧の返信数・未読数を書き換える
   */
  /**
   * 届いたメッセージで、取ってあるピン留めの一覧を直す（ADR 0054 決定 2）。
   * ピン留めは message.updated と差分に乗るので、タイムラインと同じ経路でここにも通す。取っていないルームには何もしない。
   */
  function absorbPins(messages: readonly Message[]) {
    const byRoom = new Map<string, Message[]>();
    for (const m of messages) byRoom.set(m.room_id, [...(byRoom.get(m.room_id) ?? []), m]);
    for (const [roomId, list] of byRoom) {
      update((s) => {
        const current = s.pins[roomId];
        if (current?.status !== "ready") return s;
        const next = applyPinnedMessages(current.messages, list);
        return next === current.messages ? s : { ...s, pins: { ...s.pins, [roomId]: { ...current, messages: next } } };
      });
    }
  }

  /** ルームのピン留めの一覧を取る。取り直し（再接続・差分が追いつかない）では、取れるまで手元の一覧を見せる。 */
  function loadPins(roomId: string): Promise<void> {
    return once(`pins:${roomId}`, async () => {
      update((s) => ({
        ...s,
        pins: { ...s.pins, [roomId]: s.pins[roomId] ?? { status: "loading", messages: [] } },
      }));
      try {
        const { messages } = await api.listPins(roomId);
        update((s) => ({ ...s, pins: { ...s.pins, [roomId]: { status: "ready", messages } } }));
      } catch (err) {
        update((s) => ({
          ...s,
          pins: { ...s.pins, [roomId]: { status: statusOf(err), messages: s.pins[roomId]?.messages ?? [] } },
        }));
        if (statusOf(err) === "error") console.error("failed to load pins", err);
      }
    });
  }

  return {
    absorbPins,
    loadPins,
    actions: {
      /** ルームのピン留めの一覧を取る（ADR 0054）。取ってあれば取り直さない（変化はイベントと差分で直す）。 */
      loadPins(roomId: string): Promise<void> {
        const current = core.state.pins[roomId];
        if (current && current.status !== "error") return Promise.resolve();
        return loadPins(roomId);
      },
    },
  };
}

export type Pins = ReturnType<typeof createPins>;
