/**
 * 「後で」（自分用の保存。ADR 0054）の、状態を持たない計算。
 *
 * 保存の行は 1 つのメッセージに 1 つで、状態（タブ）だけが変わる。届いた 1 件（saved.updated・差分・操作の応答）で
 * 手元のタブの一覧を直すときは、「全部のタブから一度外して、いまの状態のタブに入れ直す」だけにする。
 */
import type { SavedItem, SavedState } from "@/lib/api/types.gen";

/** 一覧に出すタブ。removed（外した）は一覧に出さない（ADR 0054 決定 6）。 */
export type SavedTab = Exclude<SavedState, "removed">;

export const SAVED_TABS: readonly SavedTab[] = ["in_progress", "archived", "completed"];

/** 1 つのタブの一覧。items は保存した新しい順（保存の ID の大きい順。サーバーと同じ）。 */
export type SavedTabState = {
  status: "loading" | "ready" | "error";
  items: SavedItem[];
  hasMore: boolean;
  loadingMore: boolean;
};

/** 保存の ID の大きい順（新しく保存したものが先）。 */
export function compareSaved(a: SavedItem, b: SavedItem): number {
  return b.id.localeCompare(a.id);
}

/**
 * 届いた 1 件で、取ってあるタブの一覧を直す。
 *
 * - どのタブからも一度外し、removed でなければ、いまの状態のタブに並びの位置で入れる
 * - 入れる先のタブにまだ続き（hasMore）があるなら、読み込んだ範囲より古いものは入れない（続きを読んだときに出る）
 * - 取っていないタブには何もしない（開いたときに取る）
 *
 * 何も変わらなければ、同じオブジェクトをそのまま返す。
 */
export function applySavedItem(
  tabs: Readonly<Partial<Record<SavedTab, SavedTabState>>>,
  item: SavedItem,
): Partial<Record<SavedTab, SavedTabState>> {
  let changed = false;
  const next: Partial<Record<SavedTab, SavedTabState>> = { ...tabs };
  for (const tab of SAVED_TABS) {
    const current = tabs[tab];
    if (!current) continue;
    const index = current.items.findIndex((i) => i.message_id === item.message_id);
    const existing = index >= 0 ? current.items[index] : undefined;
    // 手元の方が新しい（応答とイベントが前後して届いた）なら、古い方で上書きしない
    if (existing && existing.change_seq > item.change_seq) continue;
    let items = existing ? current.items.filter((i) => i.message_id !== item.message_id) : current.items;
    if (item.state === tab) {
      const oldest = items.at(-1);
      if (!current.hasMore || oldest === undefined || item.id > oldest.id) items = [...items, item].sort(compareSaved);
    }
    if (items !== current.items && !sameItems(items, current.items)) {
      next[tab] = { ...current, items };
      changed = true;
    }
  }
  return changed ? next : (tabs as Partial<Record<SavedTab, SavedTabState>>);
}

function sameItems(a: readonly SavedItem[], b: readonly SavedItem[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}
