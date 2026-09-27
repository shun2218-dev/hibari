import type { HuddleListFilter, HuddleSuggestion, PastHuddle } from "@/lib/api/types.gen";
import type { ChatApi } from "@/lib/chat/api/chat-api";

/**
 * ハドルの一覧の「最近のハドルミーティング」と提案のカード（ADR 0067 決定 6・7）。
 *
 * 一覧は画面を開いたときに取り、ハドルが終わったら取り直す（一覧のためのイベントはない。決定 6）。
 * 進行中のハドルはここに持たない（ストアのルームの状態から描く）。
 * 絞り込みを変えたら、前の問い合わせの結果が後から届いても捨てる（generation で見分ける）。
 */
export type RecentHuddlesQuery = { filter: HuddleListFilter; participantId?: string; roomId?: string };

export type RecentHuddlesState = {
  workspaceId?: string;
  query?: RecentHuddlesQuery;
  /** loading は 1 ページ目を取っている。絞り込みを変えた直後は items を空にする（前の条件の行を見せない）。 */
  status: "idle" | "loading" | "ready";
  items: PastHuddle[];
  nextCursor: string | null;
  loadingMore: boolean;
  suggestions?: HuddleSuggestion[];
};

const initial: RecentHuddlesState = { status: "idle", items: [], nextCursor: null, loadingMore: false };

export function createRecentHuddles(api: Pick<ChatApi, "listHuddles" | "huddleSuggestions">) {
  let state = initial;
  const listeners = new Set<() => void>();
  let generation = 0;

  function update(next: RecentHuddlesState) {
    state = next;
    for (const listener of listeners) listener();
  }

  async function fetchFirst(workspaceId: string, query: RecentHuddlesQuery, gen: number) {
    try {
      const page = await api.listHuddles(workspaceId, query);
      if (gen !== generation) return;
      update({ ...state, status: "ready", items: page.huddles, nextCursor: page.next_cursor, loadingMore: false });
    } catch (err) {
      if (gen !== generation) return;
      // 取得の失敗の画面はデザインにない。空の一覧にして、次に開いたときに取り直す
      console.error("failed to load recent huddles", err);
      update({ ...state, status: "ready", items: [], nextCursor: null });
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): RecentHuddlesState {
      return state;
    },

    /** 一覧を開いた・絞り込みを変えた。1 ページ目から取り直す。 */
    load(workspaceId: string, query: RecentHuddlesQuery) {
      const gen = ++generation;
      const sameList = state.workspaceId === workspaceId && JSON.stringify(state.query) === JSON.stringify(query);
      update({
        ...state,
        workspaceId,
        query,
        status: "loading",
        // 同じ条件の取り直し（ハドルが終わった）なら、届くまで今の行を残す
        items: sameList ? state.items : [],
        nextCursor: sameList ? state.nextCursor : null,
        loadingMore: false,
        suggestions: state.workspaceId === workspaceId ? state.suggestions : undefined,
      });
      void fetchFirst(workspaceId, query, gen);
    },

    /** いちばん下の近くまで読んだ。続きがあれば次のページを足す。 */
    async loadMore() {
      const { workspaceId, query, nextCursor, loadingMore } = state;
      if (!workspaceId || !query || nextCursor === null || loadingMore) return;
      const gen = generation;
      update({ ...state, loadingMore: true });
      try {
        const page = await api.listHuddles(workspaceId, { ...query, before: nextCursor });
        if (gen !== generation) return;
        const known = new Set(state.items.map((h) => h.id));
        update({
          ...state,
          items: [...state.items, ...page.huddles.filter((h) => !known.has(h.id))],
          nextCursor: page.next_cursor,
          loadingMore: false,
        });
      } catch (err) {
        if (gen !== generation) return;
        console.error("failed to load more huddles", err);
        update({ ...state, loadingMore: false });
      }
    },

    /** 提案のカードを取る（一覧と分けて、ページをめくるたびに計算し直さない。決定 7）。 */
    async loadSuggestions(workspaceId: string) {
      try {
        const { suggestions } = await api.huddleSuggestions(workspaceId);
        if (state.workspaceId !== undefined && state.workspaceId !== workspaceId) return;
        update({ ...state, suggestions });
      } catch (err) {
        console.error("failed to load huddle suggestions", err);
      }
    },

    /** 行の「後で」の印を手元で変える（保存・外すはチャットのストアが行う）。 */
    markSaved(huddleId: string, saved: boolean) {
      if (!state.items.some((h) => h.id === huddleId && h.saved !== saved)) return;
      update({ ...state, items: state.items.map((h) => (h.id === huddleId ? { ...h, saved } : h)) });
    },
  };
}

export type RecentHuddlesStore = ReturnType<typeof createRecentHuddles>;
