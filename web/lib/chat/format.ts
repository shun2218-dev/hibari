/**
 * チャットの画面に出す時刻の文言。
 *
 * API は時刻を RFC 3339（UTC）で返す。どの日に属するかは見る人のタイムゾーンで決まるので、整形はクライアントで行う。
 * タイムゾーンはテストで固定できるように引数で受け取る（省略すると実行環境のもの）。
 */

type DayParts = { year: number; month: number; day: number };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let formatter = partsFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    partsFormatters.set(key, formatter);
  }
  return formatter;
}

function localParts(date: Date, timeZone: string | undefined) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
  return parts as DayParts & { hour: number; minute: number };
}

/** その日を表すキー（`2026-9-13`）。日付の区切りを入れるかの判定に使う。 */
export function dayKey(date: Date, timeZone?: string): string {
  const { year, month, day } = localParts(date, timeZone);
  return `${year}-${month}-${day}`;
}

/** メッセージの時刻（`09:41`）。 */
export function formatTime(date: Date, timeZone?: string): string {
  const { hour, minute } = localParts(date, timeZone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** タイムラインの日付の区切り（`2026年9月13日`）。 */
export function formatDate(date: Date, timeZone?: string): string {
  const { year, month, day } = localParts(date, timeZone);
  return `${year}年${month}月${day}日`;
}

/** 招待リンクの有効期限（`9月20日 18:00`）。年は出さない（有効期限は最長 30 日。ADR 0011）。 */
export function formatDayTime(date: Date, timeZone?: string): string {
  const { month, day } = localParts(date, timeZone);
  return `${month}月${day}日 ${formatTime(date, timeZone)}`;
}

/**
 * サイドバーの最後のメッセージの時刻。今日なら時刻、昨日なら「昨日」、今年なら月日、それより前なら年も付ける。
 * 「昨日」は 24 時間前ではなく、見る人の暦の前日。
 */
export function formatListTime(date: Date, now: Date, timeZone?: string): string {
  const d = localParts(date, timeZone);
  const today = localParts(now, timeZone);
  if (sameDay(d, today)) return formatTime(date, timeZone);

  // 暦の前日。日付だけを UTC の Date に置いて 1 日戻すと、月や年の境目も正しく扱える。
  const y = new Date(Date.UTC(today.year, today.month - 1, today.day - 1));
  if (sameDay(d, { year: y.getUTCFullYear(), month: y.getUTCMonth() + 1, day: y.getUTCDate() })) return "昨日";

  if (d.year === today.year) return `${d.month}月${d.day}日`;
  return `${d.year}年${d.month}月${d.day}日`;
}

/**
 * ステータスがいつ消えるか（`17:00 まで` / `9月25日 17:00 まで`。ADR 0049）。
 * 今日なら時刻だけにする。ホバーに出す短い文言なので、年は出さない（期限は先でもせいぜい数か月）。
 */
export function formatStatusExpiry(date: Date, now: Date, timeZone?: string): string {
  const d = localParts(date, timeZone);
  const today = localParts(now, timeZone);
  if (sameDay(d, today)) return `${formatTime(date, timeZone)} まで`;
  return `${formatDayTime(date, timeZone)} まで`;
}

function sameDay(a: DayParts, b: DayParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** 添付ファイルの大きさ（`248 KB`）。1024 で割り、KB 以上は小数第 1 位まで（整数部が 2 桁以上なら切り捨てて整数）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = value >= 10 ? String(Math.floor(value)) : String(Math.floor(value * 10) / 10);
  return `${text} ${units[unit]}`;
}
