/**
 * アバターの表示に使う値を ID と名前から決める。
 *
 * users に画像はあるが（avatar_object_key）、画像がないときや読み込む前に出す「頭文字 + 地の色」を
 * どの画面でも同じにするため、色は表示名ではなく不変の ID から決める（表示名を変えても色が変わらない）。
 */

/** globals.css の --color-avatar-1〜6 に対応する番号。 */
export type AvatarColor = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * ID を FNV-1a（32 bit）でハッシュし、1〜6 に割り当てる。
 *
 * 暗号学的な強さは要らず、同じ ID が常に同じ色になり、ULID の末尾が少し違うだけでも散らばればよい。
 * ULID の先頭はタイムスタンプで、同じ時期に作ったユーザーほど似るので、先頭の数文字だけを使う方式にはしない。
 */
export function avatarColor(id: string): AvatarColor {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (((hash >>> 0) % 6) + 1) as AvatarColor;
}

/**
 * 表示名の最初の 1 文字。サロゲートペア（絵文字など）を半分で切らないよう、コードポイント単位で取る。
 */
export function avatarInitial(name: string): string {
  const [first] = Array.from(name.trim());
  return first ?? "?";
}
