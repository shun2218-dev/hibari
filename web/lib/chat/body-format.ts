/**
 * 本文の書式の解釈（ADR 0051）。
 *
 * 保存されている本文（テキスト）を、ブロックとインラインの木に分ける。描くのは `MessageBody` で、ここは文字列を読むだけの純粋な関数にする。
 * HTML の文字列は作らない。木の葉はすべてただの文字列で、描く側が React のテキストとして出すので、`<script>` は文字のまま見える。
 *
 * 記法（mrkdwn 寄り。ADR 0051 決定 2）
 *
 *   ブロック: ```コード```  / 行頭の `> ` 引用 / 行頭の `- ` `* ` `• ` 箇条書き / 行頭の `1. ` 番号付き
 *   インライン: `code` / *太字* / _斜体_ / ~取り消し~ / https://… / <@ULID> <!channel> <!here>
 *
 * 規則の具体例は body-format.test.ts が正本。コードの範囲の規則はサーバー（internal/chat/mention）にも同じものがある（ADR 0051 決定 5）。
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "strike"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; url: string }
  | { type: "mention"; kind: "user"; id: string; raw: string }
  | { type: "mention"; kind: "channel" | "here"; raw: string };

export type ListItem = {
  /** 番号付きリストで書かれた番号。箇条書きでは null。 */
  number: number | null;
  children: Inline[];
  /** 1 段深いリスト。同じ段で番号の有無が変わると 2 つ以上になる。 */
  sublists: ListBlock[];
};

export type ListBlock = { type: "list"; ordered: boolean; items: ListItem[] };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "quote"; children: Block[] }
  | ListBlock;

const FENCE = "```";

/** リストの段の上限（ADR 0051 決定 2。3 段まで）。 */
const MAX_LIST_DEPTH = 3;

/** 行頭のリストの記号。字下げは空白 2 つで 1 段。番号は 9 桁まで（数として扱える範囲に抑える）。 */
const LIST_LINE = /^( *)(?:([-*•])|(\d{1,9})\.) (.*)$/u;

/** 引用の行。`>` の後ろの空白 1 つは記号の一部として落とす。 */
const QUOTE_LINE = /^>(?: |$)(.*)$/u;

/** メンションのトークン（ADR 0041）。ULID の厳密な検証は表示ではしない（mentions.ts と同じ理由）。 */
const MENTION = /^(?:<@([0-9A-Za-z]{26})>|<!(channel|here)>)/u;

/** URL に含める文字。ASCII の空白・制御文字以外で、`<` `>` `` ` `` は含めない（トークンとコードの記号のため）。 */
const URL_CHAR = /[!-~]/u;
const URL_EXCLUDED = new Set(["<", ">", "`"]);

/** URL の末尾から落とす文字。句読点・閉じ括弧と、書式の記号（`*https://…*` の閉じる記号を URL に含めない）。 */
const URL_TRAILING = /[.,;:!?)\]}'"*_~]+$/u;

const EMPHASIS: Readonly<Record<string, "bold" | "italic" | "strike">> = { "*": "bold", _: "italic", "~": "strike" };

/** 本文を木に分ける。 */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  for (const segment of splitFences(body)) {
    if (segment.type === "code") blocks.push({ type: "code", text: segment.text });
    else blocks.push(...parseLines(segment.text.split("\n")));
  }
  return blocks;
}

/** コードブロックとそれ以外に分ける。閉じていない ``` はただの文字として残す。 */
function splitFences(body: string): ({ type: "text"; text: string } | { type: "code"; text: string })[] {
  const out: ({ type: "text"; text: string } | { type: "code"; text: string })[] = [];
  let rest = body;
  for (;;) {
    const open = rest.indexOf(FENCE);
    const close = open < 0 ? -1 : rest.indexOf(FENCE, open + FENCE.length);
    if (close < 0) break;
    // フェンスの前後の改行 1 つは記号の一部として落とす（「```\nコード\n```」の上下に空行を出さないため）
    const before = rest.slice(0, open).replace(/\n$/u, "");
    const code = rest
      .slice(open + FENCE.length, close)
      .replace(/^\n/u, "")
      .replace(/\n$/u, "");
    if (before !== "") out.push({ type: "text", text: before });
    out.push({ type: "code", text: code });
    rest = rest.slice(close + FENCE.length).replace(/^\n/u, "");
  }
  if (rest !== "" || out.length === 0) out.push({ type: "text", text: rest });
  return out;
}

/** 行の並びをブロックに分ける。引用とリストにならない行は、続く限り 1 つの段落にまとめる（空行も段落の中の改行として残す）。 */
function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (QUOTE_LINE.test(lines[i])) {
      const quoted: string[] = [];
      for (; i < lines.length; i++) {
        const m = QUOTE_LINE.exec(lines[i]);
        if (!m) break;
        quoted.push(m[1]);
      }
      blocks.push({ type: "quote", children: parseLines(quoted) });
    } else if (LIST_LINE.test(lines[i])) {
      const listed: RegExpExecArray[] = [];
      for (; i < lines.length; i++) {
        const m = LIST_LINE.exec(lines[i]);
        if (!m) break;
        listed.push(m);
      }
      blocks.push(...buildLists(listed));
    } else {
      const start = i;
      while (i < lines.length && !QUOTE_LINE.test(lines[i]) && !LIST_LINE.test(lines[i])) i++;
      blocks.push({ type: "paragraph", children: parseInline(lines.slice(start, i).join("\n")) });
    }
  }
  return blocks;
}

/** リストの行を、字下げに従って入れ子のリストにする。同じ段で番号の有無が変わったら、別のリストにする。 */
function buildLists(lines: RegExpExecArray[]): ListBlock[] {
  const roots: ListBlock[] = [];
  // stack[d] は、いま d 段目で項目を足しているリスト
  const stack: ListBlock[] = [];
  for (const [, indent, , number, text] of lines) {
    const ordered = number !== undefined;
    // 深くなるのは 1 段ずつ（いきなり 2 段下げても、直前の 1 つ下の段にする）
    const depth = Math.min(Math.floor(indent.length / 2), stack.length, MAX_LIST_DEPTH - 1);
    if (stack.length > depth + 1) stack.length = depth + 1;
    let list = stack[depth];
    if (!list || list.ordered !== ordered) {
      list = { type: "list", ordered, items: [] };
      if (depth === 0) roots.push(list);
      else stack[depth - 1].items[stack[depth - 1].items.length - 1].sublists.push(list);
      stack[depth] = list;
    }
    list.items.push({ number: ordered ? Number(number) : null, children: parseInline(text), sublists: [] });
  }
  return roots;
}

/** インラインの解釈。書式は行をまたがない（ADR 0051 決定 2）。 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") out.push({ type: "text", text: plain });
    plain = "";
  };

  let i = 0;
  while (i < text.length) {
    const atom = readAtom(text, i);
    if (atom) {
      flush();
      out.push(atom.node);
      i = atom.end;
      continue;
    }
    const kind = EMPHASIS[text[i]];
    const close = kind ? findCloser(text, i) : -1;
    if (kind && close > 0) {
      flush();
      out.push({ type: kind, children: parseInline(text.slice(i + 1, close)) });
      i = close + 1;
      continue;
    }
    plain += text[i];
    i++;
  }
  flush();
  return out;
}

/** 中を解釈しない部品（インラインコード・メンション・URL）が i から始まるなら、その節と終わりの位置を返す。 */
function readAtom(text: string, i: number): { node: Inline; end: number } | null {
  const c = text[i];
  if (c === "`") {
    const end = text.indexOf("`", i + 1);
    const newline = text.indexOf("\n", i + 1);
    // 中身が空のもの（``）と、行をまたぐものはコードにしない
    if (end > i + 1 && (newline < 0 || end < newline)) return { node: { type: "code", text: text.slice(i + 1, end) }, end: end + 1 };
    return null;
  }
  if (c === "<") {
    const m = MENTION.exec(text.slice(i));
    if (!m) return null;
    const raw = m[0];
    const node: Inline = m[1]
      ? { type: "mention", kind: "user", id: m[1], raw }
      : { type: "mention", kind: m[2] as "channel" | "here", raw };
    return { node, end: i + raw.length };
  }
  if (c === "h" && (text.startsWith("https://", i) || text.startsWith("http://", i)) && !isWordChar(text[i - 1])) {
    let end = i;
    while (end < text.length && URL_CHAR.test(text[end]) && !URL_EXCLUDED.has(text[end])) end++;
    const url = text.slice(i, end).replace(URL_TRAILING, "");
    // スキームだけ（`https://`）はリンクにしない
    if (/^https?:\/\/[^/]/u.test(url)) return { node: { type: "link", url }, end: i + url.length };
  }
  return null;
}

/**
 * i にある書式の記号（`*` `_` `~`）が開く記号なら、対になる閉じる記号の位置を返す。なければ -1。
 *
 * 境界は「ASCII の英数字でないこと」（ADR 0051 決定 2）。日本語の文字は境界になるので `これは*太字*です` は太字になり、
 * `snake_case` や `2*3*4` はならない。開く記号の直後と閉じる記号の直前は空白であってはいけない。
 * 中のインラインコード・メンション・URL は飛ばして探す（`*a `*` b*` の真ん中の `*` で閉じない）。
 */
function findCloser(text: string, i: number): number {
  const marker = text[i];
  const next = text[i + 1];
  if (isWordChar(text[i - 1]) || next === undefined || /\s/u.test(next) || next === marker) return -1;
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === "\n") return -1;
    const atom = readAtom(text, j);
    if (atom) {
      j = atom.end;
      continue;
    }
    if (c === marker && !/\s/u.test(text[j - 1]) && !isWordChar(text[j + 1])) return j;
    j++;
  }
  return -1;
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9]/u.test(c);
}

/**
 * 本文の中のコードの範囲（記号を含む、[始まり, 終わり)）を前から順に返す。
 *
 * 入力欄の変換（mentions.ts）のように、木ではなく本文の文字列のままコードを避けたいところで使う。
 * 規則は parseBody と同じで、サーバーの internal/chat/mention の codeRanges とも同じ（ADR 0051 決定 5）。
 */
export function codeRanges(body: string): [number, number][] {
  const ranges: [number, number][] = [];
  let pos = 0;
  for (;;) {
    const open = body.indexOf(FENCE, pos);
    const close = open < 0 ? -1 : body.indexOf(FENCE, open + FENCE.length);
    if (close < 0) break;
    inlineCodeRanges(body, pos, open, ranges);
    ranges.push([open, close + FENCE.length]);
    pos = close + FENCE.length;
  }
  inlineCodeRanges(body, pos, body.length, ranges);
  return ranges;
}

/** body[from, to) の中のインラインコードの範囲を足す。コードブロックで区切られた両側のバッククォートは対にしない。 */
function inlineCodeRanges(body: string, from: number, to: number, ranges: [number, number][]) {
  for (let i = from; i < to; i++) {
    if (body[i] !== "`") continue;
    const end = body.indexOf("`", i + 1);
    const newline = body.indexOf("\n", i + 1);
    if (end > i + 1 && end < to && (newline < 0 || end < newline)) {
      ranges.push([i, end + 1]);
      i = end;
    }
  }
}

/** pos がコードの範囲の中にあるか。 */
export function inCode(ranges: readonly [number, number][], pos: number): boolean {
  return ranges.some(([start, end]) => start <= pos && pos < end);
}

/** 本文の中の URL を、出てきた順に返す（コードの中は含めない）。パーマリンクのカードを探すのに使う（ADR 0051 決定 4）。 */
export function findUrls(body: string): string[] {
  const urls: string[] = [];
  const inline = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === "link") urls.push(node.url);
      else if (node.type === "bold" || node.type === "italic" || node.type === "strike") inline(node.children);
    }
  };
  const block = (b: Block) => {
    if (b.type === "paragraph") inline(b.children);
    else if (b.type === "quote") b.children.forEach(block);
    else if (b.type === "list")
      for (const item of b.items) {
        inline(item.children);
        item.sublists.forEach(block);
      }
  };
  parseBody(body).forEach(block);
  return urls;
}
