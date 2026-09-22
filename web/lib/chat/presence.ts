/**
 * 画面に出す presence（ADR 0049）。
 *
 * サーバーは「自動で決まる状態」（`active` / `idle` / `offline`。Redis）と「本人が選んだ設定」
 * （手動の離席。Postgres）を**別々に**返す。画面に出す 3 つの状態は、その 2 つを読む側で合わせて決める。
 * ここが CLAUDE.md ルール 5 の「合わせるのは読む側」の 1 箇所で、ほかに散らさない。
 */

/** 3 つの状態。オフラインはドットを出さない（最終オンライン時刻も出さない）。 */
export type PresenceView = "online" | "away" | "offline";

/** ドットの読み上げと、管理画面の文言。 */
export const presenceLabel: Record<PresenceView, string> = {
  online: "オンライン",
  away: "離席中",
  offline: "オフライン",
};

/**
 * 自動の状態と本人の設定から、画面に出す状態を決める。
 *
 * 手動の離席が自動の状態に勝つのは `active` のときだけ。接続が無ければ（`offline`）、
 * 離席にしていても「オフライン」で、ドットは出さない（いない人を離席中に見せない）。
 */
export function displayPresence(presence: "active" | "idle" | "offline", away: boolean): PresenceView {
  if (presence === "offline") return "offline";
  return away || presence === "idle" ? "away" : "online";
}
