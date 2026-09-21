/**
 * メンションの解釈と変換（ADR 0043）。
 *
 * 保存される本文はサーバーと同じトークン（ADR 0041）。入力欄にはハンドルで書き、送る直前にここで変換する。
 *
 *   保存: `<@01J8…>` / `<!channel>` / `<!here>`
 *   入力: `@tanaka`  / `@channel`   / `@here`
 *
 * 表示のための解釈は body-format.ts（ADR 0051）に移した。ここに残るのは入力欄との変換と補完。
 * **コードの中は変換しない**（ADR 0051 決定 5）。コードの中のトークンはサーバーも数えず、表示もチップにしないので、
 * 変換すると「書いたとおりに出したいコードが ID に化ける」だけになる。
 * ULID の厳密な検証はしない。サーバーが検証済みの本文しか返さず、表示に使うのは `mentions` に入っている ID だけなので、
 * 引けなければそのままの文字列として出せば足りる。
 */

import { codeRanges, inCode } from "./body-format";

/** 補完に出す候補。individual はルームのメンバー、それ以外は全員宛て。 */
export type MentionCandidate =
  | {
      kind: "user";
      id: string;
      handle: string;
      name: string;
      avatarUrl?: string;
    }
  | { kind: "channel" | "here"; description: string };

/** 保存されている本文の中のトークン。個人は 26 文字（ULID）。 */
const TOKEN = /<@([0-9A-Za-z]{26})>|<!(channel|here)>/g;

/** 入力欄の `@ハンドル`。行頭か空白の直後だけを見る（メールアドレスの `@` を拾わないため）。 */
const TYPED = /(^|\s)@([A-Za-z0-9_]{1,32})/g;

/** ハンドルに使える文字（`internal/auth/validate.go` の handlePattern と同じ）。 */
const HANDLE_CHAR = /[A-Za-z0-9_]/;

/**
 * 入力欄の本文を、サーバーへ送る形にする。解決できるハンドルだけを変換し、残りはそのまま送る。
 * `@channel` / `@here` は、同じハンドルの人がいても全員宛てとして扱う（Slack と同じ）。
 */
export function toWireBody(
  text: string,
  candidates: readonly MentionCandidate[],
): string {
  const byHandle = handleIndex(candidates);
  const code = codeRanges(text);
  return text.replace(TYPED, (whole, lead: string, handle: string, offset: number) => {
    if (inCode(code, offset + lead.length)) return whole;
    const lower = handle.toLowerCase();
    if (lower === "channel" || lower === "here") return `${lead}<!${lower}>`;
    const user = byHandle.get(lower);
    return user ? `${lead}<@${user.id}>` : whole;
  });
}

/**
 * 保存されている本文を、入力欄で編集できる形に戻す。handles は ID からハンドルを引く表。
 * 引けない ID はトークンのまま残す（消すと、保存し直したときにメンションが外れてしまう）。
 */
export function toInputBody(
  body: string,
  handles: ReadonlyMap<string, string>,
): string {
  const code = codeRanges(body);
  return body.replace(
    TOKEN,
    (token, id: string | undefined, all: string | undefined, offset: number) => {
      if (inCode(code, offset)) return token;
      if (!id) return `@${all}`;
      const handle = handles.get(id);
      return handle ? `@${handle}` : token;
    },
  );
}

/** 補完を開くかどうか。キャレットの直前が `@` で始まる語なら、その開始位置と入力中の文字を返す。 */
export function findMentionQuery(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  let i = caret;
  while (i > 0 && HANDLE_CHAR.test(value[i - 1])) i--;
  if (i === 0 || value[i - 1] !== "@") return null;
  const at = i - 1;
  // 行頭か空白の直後の `@` だけ。単語の途中の `@`（メールアドレスなど）では開かない
  if (at > 0 && !/\s/.test(value[at - 1])) return null;
  const query = value.slice(i, caret);
  if (query.length > 32) return null;
  return { start: at, query };
}

/**
 * 候補を絞る。ハンドルの前方一致を先に、表示名の前方一致を後に並べ、それぞれ元の順を保つ。
 * `@channel` / `@here` は前方一致したときだけ、個人の後ろに出す。
 */
export function filterCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  limit = 8,
): MentionCandidate[] {
  const q = query.toLowerCase();
  const users = candidates.filter((c) => c.kind === "user");
  const byHandle = users.filter((c) => c.handle.toLowerCase().startsWith(q));
  const seen = new Set(byHandle.map((c) => c.id));
  const byName = users.filter(
    (c) => !seen.has(c.id) && c.name.toLowerCase().startsWith(q),
  );
  const all = candidates.filter(
    (c) => c.kind !== "user" && c.kind.startsWith(q),
  );
  return [...byHandle, ...byName, ...all].slice(0, limit);
}

/** 候補を確定したときの本文とキャレットの位置。後ろに半角スペースを足して、続けて書けるようにする。 */
export function applyCompletion(
  value: string,
  start: number,
  caret: number,
  candidate: MentionCandidate,
): { value: string; caret: number } {
  const inserted = `@${candidate.kind === "user" ? candidate.handle : candidate.kind} `;
  return {
    value: value.slice(0, start) + inserted + value.slice(caret),
    caret: start + inserted.length,
  };
}

/** 候補の表示に使う文字列。個人はハンドル、全員宛ては `channel` / `here`。 */
export function candidateKey(candidate: MentionCandidate): string {
  return candidate.kind === "user" ? candidate.id : candidate.kind;
}

/**
 * 送る本文に全員宛てが入っているか。確認のモーダルを出すかどうかの判定に使う（ADR 0043）。
 * 両方入っていたら、飛ぶ範囲が広い `channel` を返す。
 */
export function mentionAll(body: string): "channel" | "here" | null {
  let here = false;
  const code = codeRanges(body);
  for (const m of body.matchAll(TOKEN)) {
    // コードの中の全員宛てはサーバーも数えないので、確認を出さない
    if (inCode(code, m.index)) continue;
    if (m[2] === "channel") return "channel";
    if (m[2] === "here") here = true;
  }
  return here ? "here" : null;
}

/** 候補から「ID → ハンドル」の表を作る。編集のときに `<@ULID>` を `@ハンドル` へ戻すのに使う。 */
export function mentionHandles(candidates: readonly MentionCandidate[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of candidates) if (c.kind === "user") map.set(c.id, c.handle);
  return map;
}

function handleIndex(candidates: readonly MentionCandidate[]) {
  const map = new Map<string, { id: string }>();
  for (const c of candidates)
    if (c.kind === "user") map.set(c.handle.toLowerCase(), { id: c.id });
  return map;
}
