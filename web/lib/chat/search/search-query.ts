import type { RoomKind } from "@/lib/api/types.gen";

/**
 * 検索の条件（ADR 0061 決定 5）。
 *
 * **入力欄の修飾子（`in:` `from:` `before:`）とフィルターのダイアログは、どちらもこの 1 つの値を編集する。**
 * 入力欄 → 条件が `parseSearchQuery`、条件 → 入力欄が `formatSearchQuery`。
 * 2 つの入り口が別々の状態を持つと、片方だけが直る事故が起きる。
 *
 * 名前から ID への解決はここで行う（クライアントが知らないルーム = 読めないルーム）。
 * サーバーは名前を受け取らない。名前で受け取ると、読めないチャンネルの存在が
 * 「その名前が有効かどうか」で漏れるため（ADR 0011 と同じ理由）。
 */
export type SearchFilters = {
  sender?: { id: string; name: string };
  room?: { id: string; kind: RoomKind; name: string };
  /** `after:` / `before:` / `on:` / `during:` を畳んだ範囲。ローカルの `YYYY-MM-DD`。 */
  after?: string;
  /** その日を含む（`before:2026-09-01` は 9/1 まで）。API には翌日の 0 時にして送る。 */
  before?: string;
};

/** 本文の条件（`text`）と絞り込みを合わせたもの。画面が持つのはこれ 1 つ。 */
export type SearchQuery = SearchFilters & { text: string };

/** 名前から ID を引くための表。画面が持っているルームとメンバーをそのまま渡す。 */
export type SearchLookup = {
  rooms: readonly { id: string; kind: RoomKind; name: string }[];
  members: readonly { id: string; name: string }[];
};

/** 日付の選択肢（ADR 0061 決定 5 の `before:` / `after:` を、よく使う形にまとめたもの）。 */
export const SEARCH_DATE_CHOICES = [
  { value: "any", label: "いつでも" },
  { value: "today", label: "今日" },
  { value: "7d", label: "過去 7 日間" },
  { value: "30d", label: "過去 30 日間" },
] as const;

export type SearchDateChoice = (typeof SEARCH_DATE_CHOICES)[number]["value"];

/** 選択肢を日付の範囲にする。`today` は端末の今日（`YYYY-MM-DD`）を渡す。 */
export function dateRangeOf(choice: SearchDateChoice, today: string): Pick<SearchFilters, "after" | "before"> {
  switch (choice) {
    case "today":
      return { after: today, before: today };
    case "7d":
      return { after: shiftDate(today, -6) };
    case "30d":
      return { after: shiftDate(today, -29) };
    default:
      return {};
  }
}

/** 範囲がどの選択肢に当たるかを返す。当てはまらなければ `any`（チップには日付そのものを出す）。 */
export function dateChoiceOf(filters: SearchFilters, today: string): SearchDateChoice {
  for (const { value } of SEARCH_DATE_CHOICES) {
    if (value === "any") continue;
    const range = dateRangeOf(value, today);
    if (range.after === filters.after && range.before === filters.before) return value;
  }
  return "any";
}

/** 日付のチップに出す文言。範囲がなければ undefined。 */
export function dateLabel(filters: SearchFilters, today: string): string | undefined {
  const choice = dateChoiceOf(filters, today);
  if (choice !== "any") return SEARCH_DATE_CHOICES.find((c) => c.value === choice)?.label;
  if (filters.after !== undefined && filters.before !== undefined) return `${filters.after} 〜 ${filters.before}`;
  if (filters.after !== undefined) return `${filters.after} 以降`;
  if (filters.before !== undefined) return `${filters.before} まで`;
  return undefined;
}

/** `YYYY-MM-DD` を日数だけずらす。月またぎは Date に任せる（UTC で計算して時差の影響を受けないようにする）。 */
export function shiftDate(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** 修飾子の名前。`-` を付けた除外（`-in:`）は 6.16 では作らない（ADR 0061 決定 5）。 */
const MODIFIERS = ["in", "from", "before", "after", "on"] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 入力欄の文字列を条件にする。
 *
 * 解決できない名前（`in:#ないチャンネル`）は、修飾子としては捨てて**本文の条件に残す**。
 * 黙って全部を無視すると「打ったのに効かない」になり、エラーにすると打っている途中で赤くなる。
 */
export function parseSearchQuery(input: string, lookup: SearchLookup): SearchQuery {
  const query: SearchQuery = { text: "" };
  const rest: string[] = [];
  for (const token of splitTokens(input)) {
    const modifier = MODIFIERS.find((m) => token.toLowerCase().startsWith(`${m}:`));
    if (modifier === undefined) {
      rest.push(token);
      continue;
    }
    if (!applyModifier(query, modifier, unquote(token.slice(modifier.length + 1)), lookup)) {
      rest.push(token);
    }
  }
  query.text = rest.join(" ");
  return query;
}

/** 修飾子を 1 つ当てはめる。解決できなければ false（本文の条件に戻す）。 */
function applyModifier(query: SearchQuery, modifier: (typeof MODIFIERS)[number], value: string, lookup: SearchLookup) {
  if (value === "") return false;
  switch (modifier) {
    case "in": {
      // `#` はチャンネル、`@` は DM の相手。どちらも無しで書かれたら名前だけで探す。
      // 引用符は `"@名前"` でも `@"名前"` でも外す（打ち方を選ばせない）
      const name = unquote(value.replace(/^[#@]/, ""));
      const room = lookup.rooms.find((r) => r.name === name);
      if (!room) return false;
      query.room = { id: room.id, kind: room.kind, name: room.name };
      return true;
    }
    case "from": {
      const name = unquote(value.replace(/^@/, ""));
      const member = lookup.members.find((m) => m.name === name);
      if (!member) return false;
      query.sender = { id: member.id, name: member.name };
      return true;
    }
    case "on":
      if (!DATE_PATTERN.test(value)) return false;
      query.after = value;
      query.before = value;
      return true;
    case "after":
      if (!DATE_PATTERN.test(value)) return false;
      query.after = value;
      return true;
    case "before":
      if (!DATE_PATTERN.test(value)) return false;
      query.before = value;
      return true;
  }
}

/** 条件を入力欄の文字列にする。`parseSearchQuery` で読み直すと同じ条件に戻る。 */
export function formatSearchQuery(query: SearchQuery): string {
  const parts: string[] = [];
  if (query.room) parts.push(`in:${quote(roomToken(query.room))}`);
  if (query.sender) parts.push(`from:${quote(`@${query.sender.name}`)}`);
  if (query.after !== undefined && query.after === query.before) parts.push(`on:${query.after}`);
  else {
    if (query.after !== undefined) parts.push(`after:${query.after}`);
    if (query.before !== undefined) parts.push(`before:${query.before}`);
  }
  if (query.text !== "") parts.push(query.text);
  return parts.join(" ");
}

function roomToken(room: NonNullable<SearchQuery["room"]>): string {
  return `${room.kind === "dm" ? "@" : "#"}${room.name}`;
}

/** 空白を含む名前は `"` で囲む。囲まないと、次の語として切られてしまう。 */
function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function unquote(value: string): string {
  return value.startsWith(`"`) ? value.slice(1).replace(/"$/, "") : value;
}

/** 空白で区切る。`"` の中の空白では切らない（`from:"佐藤 直樹"`）。 */
function splitTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  const flush = () => {
    if (current !== "") tokens.push(current);
    current = "";
  };
  for (const ch of input) {
    if (ch === `"`) {
      quoted = !quoted;
      current += ch;
    } else if (!quoted && /\s/.test(ch)) {
      flush();
    } else {
      current += ch;
    }
  }
  flush();
  return tokens;
}
