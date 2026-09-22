/**
 * メンションの候補と、送る本文の全員宛ての判定（ADR 0043）。
 *
 * 保存される本文はサーバーと同じトークン（ADR 0041）。`<@01J8…>` / `<!channel>` / `<!here>`
 *
 * 入力欄はリッチテキストになり、メンションは分けられないノードとしてトークンを持つので（ADR 0052）、
 * `@ハンドル` とトークンの変換はもう要らない。表示のための解釈は body-format.ts（ADR 0051）。
 * ここに残るのは、補完の候補の絞り込みと、送る前の確認に使う全員宛ての判定。
 * コードの中の全員宛ては数えない（ADR 0051 決定 5。サーバーも数えない）。
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

/**
 * 候補を絞る。`@channel` / `@here` は前方一致したときだけ、**個人より先に**出す（Slack と同じ並び。オーナーの確認: 2026-09-21）。
 * 個人はハンドルの前方一致を先に、表示名の前方一致を後に並べ、それぞれ元の順を保つ。
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
  return [...all, ...byHandle, ...byName].slice(0, limit);
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
