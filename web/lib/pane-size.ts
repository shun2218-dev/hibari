/**
 * ユーザーが引っ張って決めたエリアの大きさ（ADR 0048）。サイドバー・メンバー・スレッドのパネルの幅。
 *
 * 既定値と最小・最大は `app/globals.css` の `--pane-*` が正本で、ここは「その変数を <html> で
 * 上書きする」だけを持つ。限界は CSS の clamp が守るので、この層は数値の意味を知らない
 * （新しいエリアを足すときは、globals.css に変数と @utility を、ここの PANES に 1 行を足す）。
 *
 * 置き場所は localStorage（端末ごと）。テーマと同じで「その端末での見た目の好み」なのでサーバーには持たない。
 * 読み書きに失敗したら「覚えていない」と同じに扱う（プライベートウィンドウ、サイトのデータを消した直後）。
 */

export const PANE_STORAGE_KEY = "hibari:pane-size";

/** 伸縮できるエリア。値は CSS 変数の名前（`--pane-` を付けたもの）と、読み上げに使う名前。 */
export const PANES = {
  sidebar: { axis: "width", label: "サイドバーの幅" },
  members: { axis: "width", label: "メンバーのパネルの幅" },
  thread: { axis: "width", label: "スレッドのパネルの幅" },
} as const satisfies Record<string, { axis: "width" | "height"; label: string }>;

export type PaneId = keyof typeof PANES;

export function paneVar(pane: PaneId): string {
  return `--pane-${pane}`;
}

type Sizes = Partial<Record<PaneId, number>>;

const listeners = new Set<() => void>();
// 覚えている値。null は「まだ読んでいない」。読むのは 1 度だけで、以後はここが現在の値になる
let sizes: Sizes | null = null;

function load(): Sizes {
  if (sizes) return sizes;
  sizes = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PANE_STORAGE_KEY) ?? "null");
    if (parsed && typeof parsed === "object") {
      for (const pane of Object.keys(PANES) as PaneId[]) {
        const value = (parsed as Record<string, unknown>)[pane];
        // 壊れた値（NaN、負、文字列）は覚えていない扱い。上限は CSS が clamp するのでここでは見ない
        if (typeof value === "number" && Number.isFinite(value) && value > 0) sizes[pane] = value;
      }
    }
  } catch {
    // 壊れた値や、使えないストレージは「覚えていない」と同じに扱う。
  }
  return sizes;
}

/** 覚えている大きさ（px）。引っ張っていなければ undefined（globals.css の既定で描く）。 */
export function paneSize(pane: PaneId): number | undefined {
  return load()[pane];
}

/** 大きさの変更を購読する（useSyncExternalStore 用）。 */
export function subscribePaneSize(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 大きさを決めて、いま見ている画面に当てる。`undefined` で既定に戻す。
 * `remember` を false にすると覚えない（引っ張っている最中は書かず、離したときに 1 度だけ書く）。
 */
export function setPaneSize(pane: PaneId, size: number | undefined, remember = true): void {
  const next = { ...load() };
  if (size === undefined) delete next[pane];
  else next[pane] = Math.round(size);
  sizes = next;

  applyPaneSize(pane, next[pane]);
  if (remember) {
    try {
      localStorage.setItem(PANE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 覚えられないだけで、この画面の見た目は変える。
    }
  }
  for (const listener of listeners) listener();
}

/** <html> の CSS 変数に書く。消すと globals.css の既定に戻る。 */
export function applyPaneSize(pane: PaneId, size: number | undefined): void {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  if (size === undefined) style.removeProperty(paneVar(pane));
  else style.setProperty(paneVar(pane), `${size}px`);
}

/** テストから状態を捨てるため（module のキャッシュを持っているので、明示的に戻す）。 */
export function resetPaneSizesForTest(): void {
  for (const pane of Object.keys(PANES) as PaneId[]) applyPaneSize(pane, undefined);
  sizes = null;
  listeners.clear();
}

/**
 * 覚えている大きさを最初の描画の前に当てる 1 行（`<script>` に入れて head に置く）。
 * React の描画を待つと、既定の幅で 1 度描いてから動くので、開いた瞬間に画面がガタつく（テーマと同じ理由）。
 */
export const paneSizeBootScript = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  PANE_STORAGE_KEY,
)})||"{}"),d=document.documentElement;${JSON.stringify(Object.keys(PANES))}.forEach(function(k){var v=s[k];if(typeof v==="number"&&isFinite(v)&&v>0)d.style.setProperty("--pane-"+k,v+"px")})}catch(e){}`;
