/**
 * 検索で一致した部分を、本文の上に重ねるための道具（ADR 0061 決定 7）。
 *
 * サーバーは本文をそのまま返し、HTML も範囲も作らない。どこが一致したかはクライアントで求める。
 * 見つけ方は、サーバーの索引の式（`lower(normalize(body, NFKC))`。ADR 0061 決定 2）と同じにする。
 * ここが違うと、「結果に出たのに本文のどこも光らない」ことが起きる。
 *
 * 正規化は文字数を変えることがある（`㈱` → `(株)`）ので、正規化した文字列の位置から元の位置に戻せるよう、
 * コードポイントごとに対応表を作る。正規化した側で探し、元の文字列を切り出す。
 */

/** 本文を一致した部分で切り分けた断片。`hit` が true のところをマーカーで塗る。 */
export type HighlightPart = { text: string; hit: boolean };

/** サーバーの索引の式と同じ正規化（NFKC → 小文字）。 */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** 正規化した文字列と、その各位置が元の文字列のどこから来たかの対応表（末尾に元の長さを 1 つ足す）。 */
function normalizedWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let at = 0;
  // コードポイントで回す（サロゲートペアを 2 つに割らないため）
  for (const ch of text) {
    const n = normalizeForSearch(ch);
    for (let i = 0; i < n.length; i++) map.push(at);
    norm += n;
    at += ch.length;
  }
  map.push(text.length);
  return { norm, map };
}

/** [start, end) の範囲。重なりは merge でまとめる。 */
type Range = { start: number; end: number };

function merge(ranges: Range[]): Range[] {
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    // 隣り合うだけ（end === start）のものもつなぐ。塗りが途切れて見えるのを防ぐ
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * `text` を、`terms` のどれかに一致した部分とそれ以外に切り分ける。
 * 一致が 1 つもなければ、`hit` が false の断片 1 つだけを返す（本文が空なら空の配列）。
 */
export function highlightParts(text: string, terms: readonly string[]): HighlightPart[] {
  const needles = terms.map(normalizeForSearch).filter((t) => t.length > 0);
  if (text.length === 0) return [];
  if (needles.length === 0) return [{ text, hit: false }];

  const { norm, map } = normalizedWithMap(text);
  const found: Range[] = [];
  for (const needle of needles) {
    for (let from = 0; ; ) {
      const at = norm.indexOf(needle, from);
      if (at < 0) break;
      found.push({ start: map[at], end: map[at + needle.length] });
      // 1 文字ずつ進めて、重なった一致も拾う（「ああ」から「ああああ」の 3 か所）
      from = at + 1;
    }
  }
  if (found.length === 0) return [{ text, hit: false }];

  const parts: HighlightPart[] = [];
  let at = 0;
  for (const r of merge(found)) {
    if (r.start > at) parts.push({ text: text.slice(at, r.start), hit: false });
    parts.push({ text: text.slice(r.start, r.end), hit: true });
    at = r.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}
