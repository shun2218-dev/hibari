import type { DeviceKind, DeviceView } from "@/components/settings/settings-sections";
import type { Session } from "@/lib/api/types.gen";

/**
 * ログイン中のデバイスの表示（`settings/devices.png`）。
 *
 * サーバーは User-Agent を保存したまま返し、表示用のラベルはクライアントが作る（ADR 0019）。
 * 解析は「だいたい当たればよい」もので、当たらなければ User-Agent をそのまま出す。
 */

const browsers: Array<[RegExp, string]> = [
  // Edge / Chrome を名乗る派生より先に見る（どちらも Chrome を含む）
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bCriOS\//, "Chrome"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const platforms: Array<[RegExp, string]> = [
  [/\bWindows/, "Windows"],
  // iPad / iPhone は「like Mac OS X」を名乗るので、macOS より先に見る
  [/\biPad/, "iPadOS"],
  [/\biPhone|\biOS/, "iOS"],
  [/\bMac OS X|\bMacintosh/, "macOS"],
  [/\bAndroid/, "Android"],
  [/\bLinux|\bX11/, "Linux"],
];

/** hibari のネイティブアプリ（Phase 7 以降）。`hibari/1.0 (iOS 18; iPhone 15)` の形を想定する。 */
const nativeApp = /^hibari\/[^\s]+\s*\(([^)]*)\)/;

export function deviceLabel(userAgent: string): string {
  const native = nativeApp.exec(userAgent);
  if (native) {
    const [platform, model] = native[1].split(";").map((part) => part.trim());
    const os = platform?.split(/\s+/)[0] ?? "";
    return [os && `hibari for ${os}`, model].filter(Boolean).join(" · ") || userAgent;
  }
  const browser = browsers.find(([re]) => re.test(userAgent))?.[1];
  const platform = platforms.find(([re]) => re.test(userAgent))?.[1];
  if (!browser && !platform) return userAgent;
  return [browser, platform].filter(Boolean).join(" · ");
}

export function deviceKind(userAgent: string): DeviceKind {
  if (nativeApp.test(userAgent)) return /\biPhone|\bAndroid/.test(userAgent) ? "phone" : "desktop";
  return /\biPhone|\biPad|\bAndroid|\bMobile\b/.test(userAgent) ? "phone" : "browser";
}

/**
 * 最後に使った時刻の文言（`settings/devices.png` の「現在アクティブ」「2分前」「昨日 18:24」「3日前」「9月2日」）。
 * デザインにある例から、1 時間未満は分、同じ日は時刻、前日は「昨日 時刻」、1 週間以内は日、それより前は日付にした。
 */
export function formatLastActive(date: Date, now: Date, timeZone?: string): string {
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;

  const day = localDay(date, timeZone);
  const today = localDay(now, timeZone);
  const time = formatClock(date, timeZone);
  const days = daysBetween(day, today);
  if (days === 0) return time;
  if (days === 1) return `昨日 ${time}`;
  if (days < 7) return `${days}日前`;
  if (day.year === today.year) return `${day.month}月${day.day}日`;
  return `${day.year}年${day.month}月${day.day}日`;
}

export function toDeviceView(session: Session, now: Date, timeZone?: string): DeviceView {
  return {
    id: session.id,
    kind: deviceKind(session.user_agent),
    name: deviceLabel(session.user_agent),
    lastActiveLabel: session.current ? "現在アクティブ" : formatLastActive(new Date(session.last_used_at), now, timeZone),
    current: session.current,
  };
}

type Day = { year: number; month: number; day: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsOf(date: Date, timeZone: string | undefined) {
  const key = timeZone ?? "";
  let formatter = formatters.get(key);
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
    formatters.set(key, formatter);
  }
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Day & { hour: number; minute: number };
}

function localDay(date: Date, timeZone: string | undefined): Day {
  const { year, month, day } = partsOf(date, timeZone);
  return { year, month, day };
}

function formatClock(date: Date, timeZone: string | undefined): string {
  const { hour, minute } = partsOf(date, timeZone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 見る人の暦での日数の差。時差をまたいでも「昨日」が正しくなるよう、日付だけを UTC に置いて引く。 */
function daysBetween(from: Day, to: Day): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86_400_000);
}
