/**
 * カレンダー（`components/ui/calendar.tsx`）が使う日付の計算。
 *
 * 日付は `YYYY-MM-DD`、月は `YYYY-MM` の文字列で持つ（`Date` を持ち回さない）。
 * `Date` を状態に持つと、時刻の有無や UTC / ローカルの違いで「同じ日なのに等しくない」が起きる。
 * 文字列なら比較も等価判定も素直で、`<input type="date">` や API の値ともそのまま行き来できる。
 *
 * 計算のときだけローカルの `Date`（`new Date(y, m - 1, d)`）にする。UTC で作ると、
 * 日本時間では 9 時間ぶん前の日になり、月初と月末が 1 日ずれる。
 */

/** 日曜から始まる曜日の見出し。 */
export const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** ローカルの Date を `YYYY-MM-DD` にする。 */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` をローカルの Date にする。形式が違えば undefined。 */
export function fromISODate(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // 2026-02-31 のような「存在しない日」を弾く（Date は 3 月に繰り上げてしまう）
  return date.getMonth() === mo - 1 && date.getDate() === d ? date : undefined;
}

/** 日付（`YYYY-MM-DD`）が属する月（`YYYY-MM`）。 */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 月（`YYYY-MM`）を n か月ずらす。 */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1 + n, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** 日付（`YYYY-MM-DD`）を n 日ずらす。 */
export function shiftDate(date: string, n: number): string {
  const d = fromISODate(date);
  if (!d) return date;
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** 「2026年9月」のような見出し。 */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

/** 「2026年9月25日（金）」のような、読み上げとボタンに使う文言。 */
export function dateLabel(date: string): string {
  const d = fromISODate(date);
  if (!d) return date;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekdayLabels[d.getDay()]}）`;
}

/**
 * 月のマス目。日曜始まりの 6 週ぶんを返し、その月でない日は undefined にする。
 * 行数を 6 で固定するのは、月を送ってもカレンダーの高さが変わらないようにするため（下の操作が動かない）。
 */
export function monthGrid(month: string): (string | undefined)[][] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = first.getDay();
  const cells: (string | undefined)[] = Array.from({ length: 42 }, (_, i) => {
    const day = i - offset + 1;
    return day >= 1 && day <= days ? `${y}-${pad(m)}-${pad(day)}` : undefined;
  });
  return Array.from({ length: 6 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
}

/** 候補に出す時刻（`HH:MM`）。30 分ごとに並べる。ここに無い時刻は打って入れられる（下の `normalizeTime`）。 */
export function halfHourTimes(): string[] {
  return Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 === 0 ? "00" : "30"}`);
}

/**
 * 打った文字を `HH:MM` にする。解釈できなければ undefined。
 *
 * Slack のデスクトップの時刻の入力は「候補の一覧 + 自由入力」なので、候補に無い時刻も受け取れるようにする。
 * `17` → `17:00`、`1705` / `17:5` → `17:05`。全角のコロンと空白も受ける（日本語入力のまま打てるように）。
 */
export function normalizeTime(input: string): string | undefined {
  const cleaned = input.trim().replace(/[：]/g, ":").replace(/\s/g, "");
  let hour: number;
  let minute: number;
  if (cleaned.includes(":")) {
    const [h, m = "0"] = cleaned.split(":");
    if (!/^\d{1,2}$/.test(h) || !/^\d{1,2}$/.test(m)) return undefined;
    [hour, minute] = [Number(h), Number(m)];
  } else if (/^\d{1,2}$/.test(cleaned)) {
    // 「17」は 17:00 のつもり
    [hour, minute] = [Number(cleaned), 0];
  } else if (/^\d{3,4}$/.test(cleaned)) {
    // 「930」「1705」はまとめて打たれた形。後ろ 2 桁が分
    [hour, minute] = [Number(cleaned.slice(0, -2)), Number(cleaned.slice(-2))];
  } else {
    return undefined;
  }
  return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : undefined;
}

/** 打った文字で候補を絞る（`17` → 17:00 / 17:30、`173` → 17:30）。空なら全部。 */
export function matchTimes(times: readonly string[], input: string): string[] {
  const digits = input.replace(/[^\d]/g, "");
  if (digits === "") return [...times];
  return times.filter((t) => t.replace(":", "").startsWith(digits));
}
