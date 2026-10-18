import type { HuddleLink } from "@/lib/api/types.gen";

import type { ChatApi } from "@/lib/chat/api/chat-api";
import { LINK_BATCH_SIZE } from "@/lib/chat/api/messages";

/**
 * 本文に貼られたハドルのリンクのカードの中身（ADR 0067 決定 2）。キーはルームの ID（ハドルのリンクはルームを指す。決定 1）。
 *
 * - undefined: まだ取っていない（取得中を含む）。カードは枠だけを出す
 * - HuddleLink: 取れた結果。status が unavailable なら「アクセスできないハドルミーティング」
 *
 * **ここで取るのは、手元のストアにないルームだけ**（参加していない public のチャンネル・別のワークスペース）。
 * ストアにあるルームは、huddle.updated で生きた状態を持っているので、そちらから描く（決定 2）。
 * ここで取った結果は取り直さない（取った時点の状態のまま。押せばプレビューが読み直すので、誤って入ることはない）。
 */
export type HuddleLinkCardState = Record<string, HuddleLink | undefined>;

/** カードの中身を持つストア（メッセージのリンクのカードと同じ形。useSyncExternalStore で購読する）。 */
export function createHuddleLinkCardStore(api: Pick<ChatApi, "resolveHuddleLinks">) {
  let state: HuddleLinkCardState = {};
  const listeners = new Set<() => void>();
  const queue = new Set<string>();
  const inflight = new Set<string>();
  let flushScheduled = false;

  function update(next: HuddleLinkCardState) {
    state = next;
    for (const listener of listeners) listener();
  }

  async function fetchRooms(roomIds: string[]) {
    for (const id of roomIds) inflight.add(id);
    try {
      const { links } = await api.resolveHuddleLinks(roomIds);
      const next = { ...state };
      // 結果は送った順で返るが、順序に頼らず、返ってきた ID で引き当てる
      for (const link of links) next[link.room_id] = link;
      update(next);
    } catch (err) {
      // カードが出ないだけで、本文は読める。次にメッセージが描き直されたときに取り直す
      console.error("failed to resolve huddle links", err);
    } finally {
      for (const id of roomIds) inflight.delete(id);
    }
  }

  function flush() {
    flushScheduled = false;
    const ids = [...queue];
    queue.clear();
    for (let i = 0; i < ids.length; i += LINK_BATCH_SIZE) void fetchRooms(ids.slice(i, i + LINK_BATCH_SIZE));
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): HuddleLinkCardState {
      return state;
    },

    /** 画面に出ているリンクのルームを頼む。まだ取っていないものだけを、同じ描画の分まとめて 1 回で取る。 */
    request(roomIds: readonly string[]) {
      for (const id of roomIds) {
        if (state[id] !== undefined || inflight.has(id)) continue;
        queue.add(id);
      }
      if (queue.size === 0 || flushScheduled) return;
      flushScheduled = true;
      queueMicrotask(flush);
    },
  };
}

export type HuddleLinkCardStore = ReturnType<typeof createHuddleLinkCardStore>;
