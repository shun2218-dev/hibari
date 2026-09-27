/**
 * メッセージへのパーマリンク（ADR 0040）。
 *
 * 形は `{オリジン}/w/{workspaceId}/r/{roomId}?m={messageId}`。スレッドの返信には `&t={threadRootId}` が付く。
 * 既存のルームの画面の URL（ADR 0025）にクエリを足しただけなので、押しても新しいページを作らない。
 *
 * 本文から URL を見つけるのは本文の書式の解釈（body-format.ts。ADR 0051）で、ここは 1 つの URL がパーマリンクかを判定する。
 */

import { findUrls } from "./body-format";

/** パーマリンクが指すメッセージ。 */
export type Permalink = {
  workspaceId: string;
  roomId: string;
  messageId: string;
  /** スレッドの返信なら親の ID。カードを押したときに開くパネルを決めるのに使う。 */
  threadRootId?: string;
};

/**
 * URL に左のメニュー（`?side=`。ADR 0058 決定 1）を足す。ホーム（`home`）は付けない。
 * 一覧からルームを開いても、サイドバーの中身をそのままにするために使う。
 */
export function withSide(href: string, side: string): string {
  if (side === "home") return href;
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("side", side);
  return `${path}?${params}`;
}

/** 1 つのメッセージに出すカードの上限（ADR 0040）。貼られた順に先頭から数える。 */
export const MAX_LINK_CARDS = 3;

/** ULID の文字列表現（Crockford の Base32。26 文字）。 */
const ULID = /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/;

function isUlid(s: string | null | undefined): s is string {
  return typeof s === "string" && ULID.test(s);
}

/** パーマリンクの URL を組み立てる。「リンクをコピー」が使う（貼る先はこのアプリの外なので、オリジンから作る）。 */
export function buildPermalink(origin: string, link: Permalink): string {
  return new URL(permalinkPath(link), origin).toString();
}

/**
 * 同じパーマリンクの、アプリの中での行き先（`/w/…/r/…?m=…`）。カードの遷移先に使う。
 * オリジンから始まる URL を `next/link` に渡すとページごと読み込み直しになるので、パスで渡す。
 */
export function permalinkPath(link: Permalink): string {
  const params = new URLSearchParams({ m: link.messageId });
  if (link.threadRootId) params.set("t", link.threadRootId);
  return `/w/${link.workspaceId}/r/${link.roomId}?${params}`;
}

/**
 * URL 文字列がこのアプリのパーマリンクなら、指しているメッセージを返す。違えば null。
 *
 * オリジンが違う URL は null にする。別のインスタンスの hibari のリンクを、自分のところの ID として
 * 問い合わせても中身は出ない（ID は別のインスタンスのもの）ので、カードにしない。
 */
export function parsePermalink(href: string, origin: string): Permalink | null {
  let url: URL;
  let base: URL;
  try {
    base = new URL(origin);
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;

  // /w/{workspaceId}/r/{roomId} だけを受ける。後ろに何か続く URL（将来のページ）は指し先が変わるので受けない。
  const parts = url.pathname.split("/").filter((p) => p !== "");
  if (parts.length !== 4 || parts[0] !== "w" || parts[2] !== "r") return null;
  const [, workspaceId, , roomId] = parts;
  const messageId = url.searchParams.get("m");
  const threadRootId = url.searchParams.get("t");
  if (!isUlid(workspaceId) || !isUlid(roomId) || !isUlid(messageId)) return null;
  if (threadRootId !== null && !isUlid(threadRootId)) return null;

  return { workspaceId, roomId, messageId, ...(threadRootId !== null ? { threadRootId } : {}) };
}

/**
 * 本文に貼られたパーマリンクを、出てきた順に返す。
 *
 * 同じメッセージを指すリンクは 1 つにまとめ、MAX_LINK_CARDS 件で打ち切る。
 * URL を見つけるのは本文の書式の解釈（ADR 0051 決定 4）。コードの中の URL はリンクにならないので、カードも出さない。
 */
export function findPermalinks(body: string, origin: string): Permalink[] {
  const found: Permalink[] = [];
  const seen = new Set<string>();
  for (const url of findUrls(body)) {
    const link = parsePermalink(url, origin);
    if (!link) continue;
    const key = linkKey(link);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(link);
    if (found.length >= MAX_LINK_CARDS) break;
  }
  return found;
}

// ---- ハドルへのリンク（ADR 0067 決定 1・2） ----

/**
 * ハドルへのリンクが指すルーム。形は `{オリジン}/w/{workspaceId}/r/{roomId}?huddle=1`（決定 1）。
 * 1 回ごとのハドルではなくルームを指す（Slack と同じ。始まる前に共有でき、何度でも使える）。
 */
export type HuddleLink = { workspaceId: string; roomId: string };

/** ハドルへのリンクのクエリ。ルームの URL にこれを足す。 */
export const HUDDLE_LINK_PARAM = "huddle";

/** ハドルへのリンクの URL を組み立てる（「ハドルミーティングのリンクをコピー」）。 */
export function buildHuddleLink(origin: string, link: HuddleLink): string {
  return new URL(huddleLinkPath(link), origin).toString();
}

/** 同じリンクの、アプリの中での行き先（`/w/…/r/…?huddle=1`）。 */
export function huddleLinkPath(link: HuddleLink): string {
  return `/w/${link.workspaceId}/r/${link.roomId}?${HUDDLE_LINK_PARAM}=1`;
}

/**
 * URL 文字列がこのアプリのハドルへのリンクなら、指しているルームを返す。違えば null。
 * `m` があればメッセージへのリンク（parsePermalink）として扱い、ここでは受けない。
 */
export function parseHuddleLink(href: string, origin: string): HuddleLink | null {
  let url: URL;
  let base: URL;
  try {
    base = new URL(origin);
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  const parts = url.pathname.split("/").filter((p) => p !== "");
  if (parts.length !== 4 || parts[0] !== "w" || parts[2] !== "r") return null;
  const [, workspaceId, , roomId] = parts;
  if (!isUlid(workspaceId) || !isUlid(roomId)) return null;
  if (url.searchParams.get(HUDDLE_LINK_PARAM) !== "1" || url.searchParams.has("m")) return null;
  return { workspaceId, roomId };
}

/**
 * 本文に貼られたハドルへのリンクを、出てきた順に返す（決定 2）。同じルームは 1 つにまとめる。
 * カードの枚数はメッセージへのリンクと合わせて MAX_LINK_CARDS 枚までなので、メッセージのカードの残りの分だけ返す。
 */
export function findHuddleLinks(body: string, origin: string): HuddleLink[] {
  const limit = MAX_LINK_CARDS - findPermalinks(body, origin).length;
  const found: HuddleLink[] = [];
  const seen = new Set<string>();
  for (const url of findUrls(body)) {
    if (found.length >= limit) break;
    const link = parseHuddleLink(url, origin);
    if (!link || seen.has(link.roomId)) continue;
    seen.add(link.roomId);
    found.push(link);
  }
  return found;
}

/** カードの取得結果を覚えるときのキー。認可はルームの単位なので、ルームとメッセージの組で持つ。 */
export function linkKey(link: LinkTarget): string {
  return `${link.roomId}/${link.messageId}`;
}

/** カードを取りにいく先。カードの中身は、どのルームのどのメッセージかだけで決まる。 */
export type LinkTarget = { roomId: string; messageId: string };

/**
 * linkKey を元に戻す。ULID に `/` は現れないので、1 つ目の `/` で必ず分けられる。
 * React の依存配列に入れられる文字列 1 つで持ち回るために使う（配列は毎回別の値になる）。
 */
export function parseLinkKey(key: string): LinkTarget {
  const [roomId = "", messageId = ""] = key.split("/");
  return { roomId, messageId };
}

/** カードの中で本文を畳む行数と文字数（ADR 0040）。 */
export const CARD_CLAMP_LINES = 6;
export const CARD_CLAMP_CHARS = 300;

export type ClampedBody = {
  /** 畳んだときに出す本文。畳む必要がなければ本文そのまま。 */
  text: string;
  /** 畳める（「すべて表示する」を出す）か。 */
  clamped: boolean;
};

/**
 * カードの本文を畳む。
 *
 * 実際に描画した高さではなく、行数と文字数で決める（ADR 0040）。描画を待たずに決まり、
 * 同じ本文なら必ず同じ結果になるので、コンポーネントのテスト（jsdom はレイアウトを計算しない）で確かめられる。
 * 実際の折り返しとはずれるが、カードは「中身が分かる程度に見せる」ためのもので、正確な行数に意味はない。
 */
export function clampCardBody(body: string): ClampedBody {
  const lines = body.split("\n");
  const tooManyLines = lines.length > CARD_CLAMP_LINES;
  const tooLong = body.length > CARD_CLAMP_CHARS;
  if (!tooManyLines && !tooLong) return { text: body, clamped: false };

  let text = tooManyLines ? lines.slice(0, CARD_CLAMP_LINES).join("\n") : body;
  if (text.length > CARD_CLAMP_CHARS) text = text.slice(0, CARD_CLAMP_CHARS);
  // 末尾の空白を落としてから「…」を付ける（改行の直後に「…」が浮かないように）。
  text = `${text.replace(/\s+$/u, "")}…`;
  // コードブロックの途中で切ったら閉じる。閉じないと ``` がただの文字になり、コードの中身が書式として解釈される（ADR 0051 決定 3）。
  // 太字などは行をまたがないので、切っても閉じていない記号がただの文字になるだけで済む
  // ``` は前から順に対にするので、数が奇数なら最後の 1 つが閉じていない
  if ((text.split("```").length - 1) % 2 === 1) text = `${text}\n\`\`\``;
  return { text, clamped: true };
}
