import type { MessageLink } from "@/lib/api/types.gen";

import { LINK_BATCH_SIZE, type ChatApi } from "@/lib/chat/api";
import { type LinkTarget, linkKey } from "./links";

/**
 * 本文に貼られたパーマリンクのカードの中身（ADR 0040）。
 *
 * - undefined: まだ取っていない（取得中を含む）。カードは枠だけを出す
 * - MessageLink: 取れた結果。status が unavailable なら「表示できません」のカード
 *
 * **取り直さない。** カードは表示するときに 1 回取るだけで、リンク先が編集・削除されても
 * 開き直すまで追従しない（オーナーと確定済み。ADR 0040）。`message.updated` などのイベントでも触らない。
 * 追従させると、自分が入っていないルームの更新まで購読することになる。
 */
export type LinkCardState = Record<string, MessageLink | undefined>;

/**
 * カードの中身を持つストア（media のストアと同じく useSyncExternalStore で購読する）。
 *
 * 画面に出ているメッセージのぶんをまとめて 1 回で取る。同じリンクを二度取りにいかない。
 */
export function createLinkCardStore(api: ChatApi) {
  let state: LinkCardState = {};
  const listeners = new Set<() => void>();

  // 次のまとめた取得を待っているリンクと、取得中のリンク（どちらも linkKey で持つ）
  const queue = new Map<string, LinkTarget>();
  const inflight = new Set<string>();
  let flushScheduled = false;

  function update(next: LinkCardState) {
    state = next;
    for (const listener of listeners) listener();
  }

  async function fetchLinks(links: LinkTarget[]) {
    const keys = links.map(linkKey);
    for (const key of keys) inflight.add(key);
    try {
      const { links: results } = await api.resolveMessageLinks(links);
      const next = { ...state };
      // 結果は送った順で返るが、順序に頼らず、返ってきた ID で引き当てる。
      for (const result of results) {
        next[linkKey({ roomId: result.room_id, messageId: result.message_id })] = result;
      }
      update(next);
    } catch (err) {
      // カードが出ないだけで、本文は読める。次にメッセージが描き直されたときに取り直す
      console.error("failed to resolve message links", err);
    } finally {
      for (const key of keys) inflight.delete(key);
    }
  }

  function flush() {
    flushScheduled = false;
    const links = [...queue.values()];
    queue.clear();
    for (let i = 0; i < links.length; i += LINK_BATCH_SIZE) {
      void fetchLinks(links.slice(i, i + LINK_BATCH_SIZE));
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): LinkCardState {
      return state;
    },

    /**
     * 画面に出ているリンクの中身を頼む。まだ取っていないものだけを取る。
     * 同じ描画の中でタイムラインとスレッドのパネルの両方から頼まれても、1 回にまとめて送る。
     */
    request(links: readonly LinkTarget[]) {
      for (const link of links) {
        const key = linkKey(link);
        if (state[key] !== undefined || inflight.has(key)) continue;
        queue.set(key, link);
      }
      if (queue.size === 0 || flushScheduled) return;
      flushScheduled = true;
      queueMicrotask(flush);
    },
  };
}

export type LinkCardStore = ReturnType<typeof createLinkCardStore>;
