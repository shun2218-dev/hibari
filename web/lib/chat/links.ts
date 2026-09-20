/**
 * メッセージへのパーマリンク（ADR 0040）。
 *
 * 形は `{オリジン}/w/{workspaceId}/r/{roomId}?m={messageId}`。スレッドの返信には `&t={threadRootId}` が付く。
 * 既存のルームの画面の URL（ADR 0025）にクエリを足しただけなので、押しても新しいページを作らない。
 *
 * 本文からリンクを見つける仕組みは、Phase 6.10（本文の書式）で作る「本文の解釈」がそのまま使えるように、
 * 「1 つの URL 文字列を判定する関数」と「本文を走査する関数」に分けてある。
 * 6.10 が入ったら、本文の解釈が parsePermalink を呼ぶ形になり、ここは変えずに済む。
 */

/** パーマリンクが指すメッセージ。 */
export type Permalink = {
  workspaceId: string;
  roomId: string;
  messageId: string;
  /** スレッドの返信なら親の ID。カードを押したときに開くパネルを決めるのに使う。 */
  threadRootId?: string;
};

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
 * 本文中の URL をリンクにするのは Phase 6.10（本文の書式）の仕事で、ここではしない。
 */
export function findPermalinks(body: string, origin: string): Permalink[] {
  const found: Permalink[] = [];
  const seen = new Set<string>();
  // 空白で区切らず、URL の始まりから走査する。日本語の本文は URL の前後に空白を置かないことが多く
  // （「これ（https://…）を見て」）、空白で切ると前の文字がくっついて読めなくなる。
  for (const match of body.matchAll(/https?:\/\/[^\s]+/gu)) {
    // 末尾の句読点や閉じ括弧は URL に含めない（「…?m=01J…）。」のような書き方のため）。
    const trimmed = match[0].replace(/[.,;:!?)\]}、。）」』]+$/u, "");
    const link = parsePermalink(trimmed, origin);
    if (!link) continue;
    const key = linkKey(link);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(link);
    if (found.length >= MAX_LINK_CARDS) break;
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
  return { text: `${text.replace(/\s+$/u, "")}…`, clamped: true };
}
