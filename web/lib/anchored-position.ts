/**
 * アンカー（メッセージの行）に合わせて画面に浮かせるパネルの位置を決める。
 *
 * 計算だけをここに置き、DOM の測定と反映はコンポーネント（`components/ui/anchored-panel.tsx`）が行う。
 * 数値の規則をテストで押さえられるようにするため。
 */

/** 位置を決めるのに要る矩形。`getBoundingClientRect` の一部。 */
export type AnchorRect = { top: number; bottom: number; left: number; right: number };

/**
 * 横の合わせ方。
 * - end: アンカーの右端に合わせる（既定）。メッセージの行のような**広い**アンカー向け
 * - start: アンカーの左端に合わせる。ボタンのような**狭い**アンカー向け。
 *   右端に合わせると、ボタンより左にパネル全体がぶら下がって、押したものから離れて見える
 */
export type PanelAlign = "start" | "end";

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
  align: PanelAlign = "end",
): PanelPlacement {
  const maxLeft = viewport.width - MARGIN - panel.width;
  const preferred = align === "start" ? anchor.left : anchor.right - GUTTER - panel.width;
  const left = Math.max(MARGIN, Math.min(preferred, maxLeft));

  const maxTop = viewport.height - MARGIN - panel.height;
  const below = anchor.top + OFFSET;
  const fitsBelow = below <= maxTop;
  // 上に開くときは、アンカーの下端から上へ伸ばす（下に開いたときと同じだけ行に重なる）
  const top = fitsBelow ? below : anchor.bottom - OFFSET - panel.height;
  return { top: Math.max(MARGIN, Math.min(top, Math.max(MARGIN, maxTop))), left, below: fitsBelow };
}

/** アンカーの横に出すときの、アンカーとの間隔。 */
const BESIDE_GAP = 8;

/**
 * パネルを、アンカーの**横**に開く（プロフィールのホバーのカード。ADR 0050 決定 6 の追記）。
 *
 * 押したアバターや名前を隠さないよう、行の上には重ねない。右に入れば右、入らなければ左に出す
 * （右端に寄ったアンカーでは、左に出る）。
 * 縦はアンカーの上端にそろえ、下からはみ出すときは画面の中まで持ち上げる。
 */
export function placeBeside(
  anchor: AnchorRect,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): PanelPlacement {
  const maxLeft = viewport.width - MARGIN - panel.width;
  const right = anchor.right + BESIDE_GAP;
  const left = right <= maxLeft ? right : Math.max(MARGIN, anchor.left - BESIDE_GAP - panel.width);

  const maxTop = viewport.height - MARGIN - panel.height;
  const top = Math.max(MARGIN, Math.min(anchor.top, maxTop));
  return { top, left, below: top >= anchor.top };
}
