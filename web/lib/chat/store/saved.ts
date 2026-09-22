import type { SavedItem } from "@/lib/api/types.gen";
import { applySavedItem, type SavedTab } from "@/lib/chat/rules/saved";
import type { ChatState } from "./state";

import type { StoreCore } from "./core";

/**
 * 「後で」（ADR 0054）。
 */
export function createSaved(
  core: StoreCore,
) {
  const { api, findMessage, once, patchMessageEverywhere, update } = core;

  // ---- 「後で」（ADR 0054）----

  // 分かっている保存の状態（message_id → 状態）。「進行中」の件数を、届いた 1 件の前後の差で直すのに使う。
  // 前の状態が分からない（一覧に出ていなかった）ときは、件数だけ取り直す
  const knownSavedStates = new Map<string, SavedItem["state"]>();

  const savedSyncing = new Map<string, { again: boolean; promise: Promise<void> }>();

  function patchSaved(
    workspaceId: string,
    recipe: (saved: NonNullable<ChatState["saved"][string]>) => NonNullable<ChatState["saved"][string]>,
  ) {
    update((s) => {
      const current = s.saved[workspaceId] ?? { tabs: {}, inProgressCount: 0, cursor: null };
      const next = recipe(current);
      return next === current ? s : { ...s, saved: { ...s.saved, [workspaceId]: next } };
    });
  }

  /** メッセージの「保存済み」の印を、置いてある場所すべてで書き換える（決定 10。change_seq は変わらない）。 */
  function markSaved(roomId: string, messageId: string, saved: boolean) {
    patchMessageEverywhere(roomId, messageId, (m) => (m.saved === saved ? m : { ...m, saved }));
    update((s) => {
      const pins = s.pins[roomId];
      if (!pins?.messages.some((m) => m.id === messageId && m.saved !== saved)) return s;
      const messages = pins.messages.map((m) => (m.id === messageId ? { ...m, saved } : m));
      return { ...s, pins: { ...s.pins, [roomId]: { ...pins, messages } } };
    });
  }

  /** 届いた 1 件（イベント・差分・操作の応答）を、タブ・件数・メッセージの印に反映する。カーソルは動かさない。 */
  function absorbSavedItem(item: SavedItem) {
    const previous = knownSavedStates.get(item.message_id);
    knownSavedStates.set(item.message_id, item.state);
    patchSaved(item.workspace_id, (saved) => {
      const tabs = applySavedItem(saved.tabs, item);
      const delta =
        previous === undefined ? 0 : Number(item.state === "in_progress") - Number(previous === "in_progress");
      return tabs === saved.tabs && delta === 0
        ? saved
        : { ...saved, tabs, inProgressCount: Math.max(0, saved.inProgressCount + delta) };
    });
    if (previous === undefined && core.state.saved[item.workspace_id]?.cursor != null) void refreshSavedCount(item.workspace_id);
    markSaved(item.room_id, item.message_id, item.state !== "removed");
  }

  /**
   * 本人ごとの change_seq で 1 件を受け取る（ADR 0054 決定 7。ルームの change_seq と同じ扱い）。
   * カーソル以下は反映済みなので捨て、カーソル + 1 なら進め、それより先なら間を差分で取り直す。
   */
  function receiveSaved(item: SavedItem) {
    const cursor = core.state.saved[item.workspace_id]?.cursor ?? null;
    if (cursor !== null && item.change_seq <= cursor) return;
    absorbSavedItem(item);
    if (cursor === null) return;
    if (item.change_seq === cursor + 1) patchSaved(item.workspace_id, (saved) => ({ ...saved, cursor: item.change_seq }));
    else void syncSaved(item.workspace_id);
  }

  /** 「進行中」の件数だけを取り直す（届いた 1 件の前の状態が分からなかったとき）。 */
  function refreshSavedCount(workspaceId: string): Promise<void> {
    return once(`saved-count:${workspaceId}`, async () => {
      try {
        const page = await api.listSaved(workspaceId, "in_progress");
        patchSaved(workspaceId, (saved) => ({ ...saved, inProgressCount: page.in_progress_count }));
      } catch (err) {
        console.error("failed to count saved messages", err);
      }
    });
  }

  /** タブの最初のページを取る。取り直しでは、取れるまで手元の一覧を見せる。 */
  function loadSavedTab(workspaceId: string, tab: SavedTab): Promise<void> {
    return once(`saved:${workspaceId}:${tab}`, async () => {
      patchSaved(workspaceId, (saved) =>
        saved.tabs[tab]
          ? saved
          : { ...saved, tabs: { ...saved.tabs, [tab]: { status: "loading", items: [], hasMore: false, loadingMore: false } } },
      );
      try {
        const page = await api.listSaved(workspaceId, tab);
        for (const item of page.items) knownSavedStates.set(item.message_id, item.state);
        const cursor = core.state.saved[workspaceId]?.cursor ?? null;
        patchSaved(workspaceId, (saved) => ({
          ...saved,
          tabs: { ...saved.tabs, [tab]: { status: "ready", items: page.items, hasMore: page.has_more, loadingMore: false } },
          inProgressCount: page.in_progress_count,
          // 最初の 1 回でカーソルを決める。一覧より前に読んだ番号なので、読んでいる間の変更は差分に必ず出る
          cursor: saved.cursor ?? page.last_change_seq,
        }));
        // すでにカーソルがあって、それより先の変更が起きていた（取りこぼした）なら、差分で追いつく
        if (cursor !== null && page.last_change_seq > cursor) void syncSaved(workspaceId);
      } catch (err) {
        patchSaved(workspaceId, (saved) => {
          const current = saved.tabs[tab];
          return {
            ...saved,
            tabs: { ...saved.tabs, [tab]: { status: "error", items: current?.items ?? [], hasMore: false, loadingMore: false } },
          };
        });
        console.error("failed to load saved messages", err);
      }
    });
  }

  /** 差分を 1 ページずつ読んで、カーソルまで追いつく（再接続・番号の飛び）。 */
  function syncSaved(workspaceId: string): Promise<void> {
    const running = savedSyncing.get(workspaceId);
    if (running) {
      running.again = true;
      return running.promise;
    }
    const entry = { again: false, promise: Promise.resolve() };
    entry.promise = (async () => {
      try {
        do {
          entry.again = false;
          for (;;) {
            const cursor = core.state.saved[workspaceId]?.cursor;
            if (cursor == null) return;
            const page = await api.listSavedChanges(workspaceId, cursor);
            for (const item of page.items) absorbSavedItem(item);
            // last_change_seq は差分を読む前の値なので、最後のページのときだけカーソルに使ってよい（ルームと同じ）
            const newest = Math.max(cursor, ...page.items.map((i) => i.change_seq));
            const next = page.has_more ? newest : Math.max(newest, page.last_change_seq);
            patchSaved(workspaceId, (saved) => ({ ...saved, cursor: Math.max(saved.cursor ?? 0, next) }));
            if (!page.has_more) break;
          }
        } while (entry.again);
      } catch (err) {
        console.error("failed to sync saved messages", err);
      } finally {
        savedSyncing.delete(workspaceId);
      }
    })();
    savedSyncing.set(workspaceId, entry);
    return entry.promise;
  }

  function findSavedItem(workspaceId: string, messageId: string): SavedItem | undefined {
    for (const tab of Object.values(core.state.saved[workspaceId]?.tabs ?? {})) {
      const found = tab?.items.find((i) => i.message_id === messageId);
      if (found) return found;
    }
    return undefined;
  }

  async function reloadSavedTabs(workspaceId: string) {
    const tabs = Object.keys(core.state.saved[workspaceId]?.tabs ?? {}) as SavedTab[];
    await Promise.all(tabs.map((tab) => loadSavedTab(workspaceId, tab)));
  }

  /**
   * 外す。DELETE は 204 で 1 件を返さないので、手元では先に一覧から外し、番号はイベント（saved.updated）で進める。
   * 失敗したらタブを取り直す。
   */
  async function removeSavedNow(workspaceId: string, messageId: string, roomId: string | undefined) {
    const item = findSavedItem(workspaceId, messageId);
    if (item) absorbSavedItem({ ...item, state: "removed", room: null, message: null, status: "unavailable" });
    else if (roomId) markSaved(roomId, messageId, false);
    try {
      await api.removeSaved(workspaceId, messageId);
    } catch (err) {
      await reloadSavedTabs(workspaceId);
      throw err;
    }
  }

  return {
    receiveSaved,
    refreshSavedCount,
    reloadSavedTabs,
    actions: {
      /**
       * 「後で」のタブを取る（ADR 0054）。ワークスペースを開いたときに「進行中」を取り、差分のカーソルを決める。
       * 取ってあれば取り直さない（変化はイベントと差分で直す）。
       */
      loadSaved(workspaceId: string, tab: SavedTab): Promise<void> {
        const current = core.state.saved[workspaceId]?.tabs[tab];
        if (current && current.status !== "error") return Promise.resolve();
        return loadSavedTab(workspaceId, tab);
      },

      /** タブの続き（古い方）を読む。 */
      async loadMoreSaved(workspaceId: string, tab: SavedTab): Promise<void> {
        const current = core.state.saved[workspaceId]?.tabs[tab];
        if (current?.status !== "ready" || !current.hasMore || current.loadingMore) return;
        const setLoading = (loadingMore: boolean) =>
          patchSaved(workspaceId, (saved) => {
            const t = saved.tabs[tab];
            return t ? { ...saved, tabs: { ...saved.tabs, [tab]: { ...t, loadingMore } } } : saved;
          });
        setLoading(true);
        try {
          const page = await api.listSaved(workspaceId, tab, current.items.at(-1)?.id);
          for (const item of page.items) knownSavedStates.set(item.message_id, item.state);
          patchSaved(workspaceId, (saved) => {
            const t = saved.tabs[tab];
            if (!t) return saved;
            const known = new Set(t.items.map((i) => i.message_id));
            const items = [...t.items, ...page.items.filter((i) => !known.has(i.message_id))];
            return { ...saved, tabs: { ...saved.tabs, [tab]: { ...t, items, hasMore: page.has_more, loadingMore: false } } };
          });
        } catch (err) {
          setLoading(false);
          console.error("failed to load more saved messages", err);
        }
      },

      syncSaved,

      /**
       * メッセージのホバーの「後で」を押した（ADR 0054）。保存済みなら外し、そうでなければ保存する。
       * 印は手元で先に変え、失敗したら戻す（リアクションと同じく順番に意味がなく、サーバーの操作は冪等）。
       */
      async toggleSaved(workspaceId: string, roomId: string, messageId: string): Promise<void> {
        const message = findMessage(roomId, messageId) ?? core.state.pins[roomId]?.messages.find((m) => m.id === messageId);
        if (!message) return;
        const wasSaved = message.saved ?? false;
        markSaved(roomId, messageId, !wasSaved);
        try {
          if (wasSaved) await removeSavedNow(workspaceId, messageId, roomId);
          else receiveSaved(await api.saveMessage(roomId, messageId));
        } catch (err) {
          markSaved(roomId, messageId, wasSaved);
          throw err;
        }
      },

      /** 保存をタブの間で動かす。一覧からは手元で先に動かし、失敗したらタブを取り直す。 */
      async moveSaved(workspaceId: string, messageId: string, to: SavedTab): Promise<void> {
        const item = findSavedItem(workspaceId, messageId);
        if (item) absorbSavedItem({ ...item, state: to });
        try {
          receiveSaved(await api.moveSaved(workspaceId, messageId, to));
        } catch (err) {
          await reloadSavedTabs(workspaceId);
          throw err;
        }
      },

      /** 「後で」から外す（一覧の「その他」と、読めない行の確認から）。 */
      removeSaved(workspaceId: string, messageId: string): Promise<void> {
        return removeSavedNow(workspaceId, messageId, findSavedItem(workspaceId, messageId)?.room_id);
      },
    },
  };
}

export type Saved = ReturnType<typeof createSaved>;
