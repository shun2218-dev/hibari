import { findUrls } from "./body-format";

/**
 * 外部のリンクのプレビュー（ADR 0065）の、本文から展開する URL の決まり。
 *
 * サーバー（internal/chat/linkpreview の Candidates）と同じ規則にする。入力欄のカード（決定 13）は送る前に出すので、
 * サーバーが送信の後に付けるカードと食い違わないように、同じ URL だけを取りに行く。
 */

/** 展開するメッセージの URL の数の上限。これより多ければ、どれも展開しない（Slack と同じ。決定 3）。 */
export const MAX_PREVIEW_LINKS = 5;

/**
 * 本文から、プレビューを出す URL を出てきた順に返す（決定 3）。
 * - URL（コードの中を除く）が 5 つより多ければ、どれも出さない
 * - 自分のアプリ（origin と同じオリジン）の URL は出さない。パーマリンクには ADR 0040 のカードが出る
 * - 同じ URL は 1 つにまとめる
 */
export function previewCandidates(body: string, origin: string): string[] {
  const all = findUrls(body);
  if (all.length > MAX_PREVIEW_LINKS) return [];
  const out: string[] = [];
  for (const raw of all) {
    if (out.includes(raw)) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.origin === origin) continue;
    out.push(raw);
  }
  return out;
}

/**
 * URL を書き終えたか。後ろに空白か改行が続いていれば書き終えている（決定 13）。
 * 本文の最後にある URL は、まだ打っている途中かもしれないので、呼ぶ側が少し待ってから取りに行く。
 */
export function isUrlFinished(body: string, url: string): boolean {
  for (let at = body.indexOf(url); at >= 0; at = body.indexOf(url, at + 1)) {
    const next = body[at + url.length];
    if (next !== undefined && /\s/u.test(next)) return true;
  }
  return false;
}
