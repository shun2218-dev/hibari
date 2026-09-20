/**
 * アンカー（メッセージの行）に合わせて画面に浮かせるパネルの位置を決める。
 *
 * 計算だけをここに置き、DOM の測定と反映はコンポーネント（`components/ui/anchored-panel.tsx`）が行う。
 * 数値の規則をテストで押さえられるようにするため。
 */

/** 位置を決めるのに要る矩形。`getBoundingClientRect` の一部。 */
export type AnchorRect = { top: number; bottom: number; right: number };

export type PanelPlacement = {
  top: number;
  left: number;
  /** 下に出したか。上下どちらに出たかを読み上げや検査から見分けるために返す。 */
  below: boolean;
};

/** アンカーの上端から下にずらす量。メッセージの行の少し内側から開く（ホバーの操作と重ならない位置）。 */
const OFFSET = 24;
/** 画面の端に残す余白。 */
const MARGIN = 8;
/** アンカーの右端から内側に寄せる量。メッセージの右の余白（px-4）に合わせる。 */
const GUTTER = 16;

/**
 * パネルを、アンカーの右上から**下**に開く。下に入りきらなければ**上**に開く。
 *
 * どちらでも画面からはみ出すときは、はみ出さない位置まで寄せる（上端が優先）。
 * 高さが画面より大きいときは上端に貼り付き、パネル自身がスクロールする。
 */
export function placePanel(
  anchor: AnchorRect,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): PanelPlacement {
  const maxLeft = viewport.width - MARGIN - panel.width;
  const left = Math.max(MARGIN, Math.min(anchor.right - GUTTER - panel.width, maxLeft));

  const maxTop = viewport.height - MARGIN - panel.height;
  const below = anchor.top + OFFSET;
  const fitsBelow = below <= maxTop;
  // 上に開くときは、アンカーの下端から上へ伸ばす（下に開いたときと同じだけ行に重なる）
  const top = fitsBelow ? below : anchor.bottom - OFFSET - panel.height;
  return { top: Math.max(MARGIN, Math.min(top, Math.max(MARGIN, maxTop))), left, below: fitsBelow };
}
