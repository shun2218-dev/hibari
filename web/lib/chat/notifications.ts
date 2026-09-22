import type { TemporaryMute } from "@/components/chat/notification-menu";
import type { NotifyLevel, RoomNotifications } from "@/lib/api/types.gen";

import { formatDayTime, formatTime } from "./format";

/**
 * ミュートと通知の設定（ADR 0055）の、表示とデータ層で共有する計算。
 *
 * 期限つきのミュートは、期限が来てもサーバーから解除のイベントが来ない（決定 5）。
 * 読む側が時計と比べて「していない」とみなし、ストアがタイマーで状態を戻す。
 */

/** 全体の設定の名前（ユーザー設定とチャンネルのメニューの「いまは「…」」で同じ文言を使う）。 */
export const notifyLevelLabels: Record<NotifyLevel, string> = {
  all: "すべて",
  mentions: "メンションと DM",
  none: "なし",
};

/** 期限の来たミュートは、していないものとして扱う（サーバーの roomNotificationsOf と同じ規則）。 */
export function isMuted(n: RoomNotifications | null | undefined, now: number): boolean {
  if (!n?.muted) return false;
  return n.muted_until === null || Date.parse(n.muted_until) > now;
}

/**
 * 一時的なミュートの期限。「明日まで」は明日いっぱい（オーナーの判断）なので、**翌々日の 0:00**。
 * 日付の区切りは端末のタイムゾーン（サーバーはタイムゾーンを知らない。カスタムステータスの「今日」と同じ）。
 */
export function temporaryMuteUntil(duration: TemporaryMute, now: Date): Date {
  if (duration === "hour") return new Date(now.getTime() + 60 * 60 * 1000);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
}

/**
 * いつまでミュートしているか（メニューの「〜ミュート中」）。
 * 日付の変わり目で終わるもの（「明日まで」）は、前の日の「いっぱい」と書く。「9月24日 0:00 まで」だと、24 日もミュートに見えるため。
 */
export function muteUntilLabel(until: Date, now: Date, timeZone?: string): string {
  const endOfDay = formatTime(until, timeZone) === "00:00";
  const last = endOfDay ? new Date(until.getTime() - 1) : until;
  const day = relativeDay(last, now, timeZone);
  if (endOfDay) return `${day ?? formatDayTime(last, timeZone).split(" ")[0]}いっぱい`;
  return day ? `${day} ${formatTime(until, timeZone)} まで` : `${formatDayTime(until, timeZone)} まで`;
}

function relativeDay(date: Date, now: Date, timeZone?: string): "今日" | "明日" | undefined {
  const key = (d: Date) => formatDayTime(d, timeZone).split(" ")[0];
  if (key(date) === key(now)) return "今日";
  if (key(date) === key(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return "明日";
  return undefined;
}

/** いちばん早く来るミュートの期限（ミリ秒）。ストアがこの時刻にタイマーを張る。なければ null。 */
export function nextMuteExpiry(notifications: Iterable<RoomNotifications | null | undefined>, now: number): number | null {
  let next: number | null = null;
  for (const n of notifications) {
    if (!n?.muted || n.muted_until === null) continue;
    const at = Date.parse(n.muted_until);
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}
