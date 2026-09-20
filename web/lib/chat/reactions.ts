/**
 * 絵文字のリアクションの表示まわり（ADR 0044）。
 *
 * ここに置くのは「見た目を決めるだけで、状態を持たない計算」だけ。付け外しそのものはデータ層の仕事。
 */

/** 1 つのメッセージに付けられる絵文字の種類の上限（ADR 0044 決定 5）。超えるとサーバーが 422 を返す。 */
export const MAX_REACTION_KINDS = 20;

/**
 * リアクションのチップにホバーしたときに出す「誰が付けたか」（ADR 0044 決定 3）。
 *
 * API が返す名前は先頭 8 人までなので、`count` に足りないぶんは「他 N 人」でまとめる。
 * 名前が 1 つも引けない（全員がルームを抜けたあとなど）ときは、人数だけで言う。
 */
export function reactionNamesLabel(reaction: { emoji: string; count: number; names: string[] }): string {
  const { emoji, count, names } = reaction;
  const rest = Math.max(0, count - names.length);
  const who =
    names.length === 0
      ? `${count} 人`
      : rest === 0
        ? names.join("、")
        : `${names.join("、")} 他 ${rest} 人`;
  return `${who}が ${emoji} を付けました`;
}

/**
 * `#2f6f62` を emoji-mart の CSS 変数が求める `47, 111, 98` に直す（ADR 0044 決定 7）。
 *
 * emoji-mart は `rgba(var(--em-rgb-accent), 0.1)` のように色を組み立てるので、16 進のままでは渡せない。
 * 読めない値（`rgb(...)` や空文字）は undefined を返し、呼ぶ側はライブラリの既定色に任せる。
 */
export function rgbTriplet(color: string): string | undefined {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (hex === undefined) return undefined;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const value = Number.parseInt(full, 16);
  return `${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}`;
}
