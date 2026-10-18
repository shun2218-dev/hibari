"use client";

import type { UserStatusView } from "@/components/chat/types";

import type { StatusExpiry } from "./status-dialog";

/**
 * カスタムステータス（ADR 0049）の、よく使う組み合わせと期限の文言。
 */
export const statusExpiryLabel: Record<StatusExpiry, string> = {
  none: "削除しない",
  "30m": "30 分",
  "1h": "1 時間",
  "4h": "4 時間",
  today: "今日",
  week: "今週",
  custom: "日時を選択",
};

/** よく使うステータスの候補。Slack と同じく、押すと絵文字と文言がそのまま入る。 */
export const statusPresets: readonly UserStatusView[] = [
  { emoji: "📅", text: "会議中" },
  { emoji: "🚃", text: "移動中" },
  { emoji: "🍽️", text: "食事中" },
  { emoji: "🎧", text: "集中しています" },
  { emoji: "🌴", text: "休暇中" },
];
