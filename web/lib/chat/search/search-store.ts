import type { SearchResult } from "@/lib/api/types.gen";
import type { ChatApi } from "@/lib/chat/api/chat-api";

import { formatSearchQuery, type SearchQuery } from "./search-query";

/**
 * 検索の結果を持つストア（ADR 0061）。
 *
 * **結果は要求した時点のもの。** WebSocket のイベントは作らず（決定 8）、開いたまま新しい発言が来ても増えない。
 * だからチャットの本体のストア（`ChatState`）には入れず、ここに切り離して持つ。
 * 画面を閉じれば消えてよい値なので、再接続の同期（絶対ルール 4）の対象にもしない。
 *
 * 前の検索が飛んでいる間に次の検索が始まったら、**古い結果を捨てる**（`runId` で見分ける）。
 * 打つたびに検索する作りではないが、絞り込みを続けて変えると要求が重なる。
 */
export type SearchState = {
  /** いま出している検索。まだ何も検索していなければ null。 */
  query: SearchQuery | null;
  results: SearchResult[];
  /** 本文の中で塗る語（サーバーが `q` を解釈した結果。決定 7）。 */
  terms: string[];
  /** 次のページの位置。null なら続きがない。 */
  cursor: string | null;
  status: "idle" | "loading" | "loading-more" | "ready" | "error";
};

const EMPTY: SearchState = { query: null, results: [], terms: [], cursor: null, status: "idle" };

export function createSearchStore(api: ChatApi) {
  let state: SearchState = EMPTY;
  const listeners = new Set<() => void>();
  // いま走っている検索。これと違う結果が返ってきたら捨てる
  let runId = 0;

  function update(next: Partial<SearchState>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): SearchState {
      return state;
    },

    /**
     * 検索し直す。同じ条件でもう一度呼べば取り直す（「再検索」）。
     * 本文の条件が空なら、サーバーに聞かずに空の結果にする（サーバーは 422 を返すため）。
     */
    async run(workspaceId: string, query: SearchQuery): Promise<void> {
      const id = ++runId;
      if (query.text.trim() === "") {
        update({ query, results: [], terms: [], cursor: null, status: "ready" });
        return;
      }
      update({ query, results: [], terms: [], cursor: null, status: "loading" });
      try {
        const page = await api.searchMessages(workspaceId, query);
        if (id !== runId) return; // 次の検索が始まっている
        update({ results: page.items, terms: page.terms, cursor: page.next_cursor ?? null, status: "ready" });
      } catch (err) {
        if (id !== runId) return;
        console.error("failed to search messages", err);
        update({ status: "error" });
      }
    },

    /** 続きを読む。取得中・続きなし・まだ検索していないときは何もしない。 */
    async loadMore(workspaceId: string): Promise<void> {
      const { query, cursor, status } = state;
      if (query === null || cursor === null || status !== "ready") return;
      const id = runId;
      update({ status: "loading-more" });
      try {
        const page = await api.searchMessages(workspaceId, query, cursor);
        if (id !== runId) return;
        update({
          results: [...state.results, ...page.items],
          terms: page.terms,
          cursor: page.next_cursor ?? null,
          status: "ready",
        });
      } catch (err) {
        if (id !== runId) return;
        console.error("failed to load more search results", err);
        // 続きが取れなくても、いま出ている結果は残す
        update({ status: "ready" });
      }
    },

    /** 検索をやめる（× を押した・ワークスペースを移った）。 */
    clear(): void {
      runId++;
      update(EMPTY);
    },
  };
}

export type SearchStore = ReturnType<typeof createSearchStore>;

/** URL に載せる検索の文字列。入力欄に出すものと同じ（リロードしても同じ結果に戻る）。 */
export function searchParam(query: SearchQuery): string {
  return formatSearchQuery(query);
}
