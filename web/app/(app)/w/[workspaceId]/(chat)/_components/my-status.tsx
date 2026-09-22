"use client";

import { useState } from "react";

import {
  DEFAULT_STATUS_EMOJI,
  type StatusExpiry,
  type StatusExpiryCustom,
  StatusDialog,
} from "@/components/chat/status-dialog";
import type { UserStatusView } from "@/components/chat/types";
import { useChatStore } from "@/hooks/chat/use-chat-store";
import { fromISODate, monthOf, normalizeTime, toISODate } from "@/lib/calendar";

/**
 * ステータスを設定するダイアログの状態と、相対の期限を絶対の時刻にする変換（ADR 0049 決定 5）。
 *
 * **時刻を決めるのはクライアント。** サーバーはユーザーのタイムゾーンを知らないので、
 * 「今日」「今週」のような相対の期限は、押した端末の時計で絶対の時刻にしてから送る。
 */
export function MyStatusDialog({
  workspaceId,
  status,
  onClose,
}: {
  workspaceId: string;
  /** いま設定しているステータス（無ければ未設定）。 */
  status?: UserStatusView;
  onClose: () => void;
}) {
  const store = useChatStore();
  const now = new Date();
  const [emoji, setEmoji] = useState(status?.emoji ?? DEFAULT_STATUS_EMOJI);
  const [text, setText] = useState(status?.text ?? "");
  const [expiry, setExpiry] = useState<StatusExpiry>("none");
  const [custom, setCustom] = useState<StatusExpiryCustom>({ date: toISODate(now), time: "" });
  const [month, setMonth] = useState(monthOf(toISODate(now)));
  const [picker, setPicker] = useState<"emoji" | "date" | "time">();
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await store.setStatus(workspaceId, {
        emoji,
        text: text.trim(),
        expires_at: expiresAt(expiry, custom, new Date())?.toISOString() ?? null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (saving) return;
    setSaving(true);
    try {
      await store.setStatus(workspaceId, null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <StatusDialog
      open
      emoji={emoji}
      text={text}
      expiry={expiry}
      custom={custom}
      calendarMonth={month}
      today={toISODate(now)}
      minTime={`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`}
      openPicker={picker === "emoji" ? undefined : picker}
      pickerOpen={picker === "emoji"}
      canClear={status !== undefined}
      onClose={onClose}
      onTogglePicker={() => setPicker((p) => (p === "emoji" ? undefined : "emoji"))}
      onPickEmoji={(picked) => {
        setEmoji(picked);
        setPicker(undefined);
      }}
      onChangeText={setText}
      onChangeExpiry={setExpiry}
      onChangeCustom={(next) => {
        setCustom(next);
        // 日付を選んだらカレンダーを閉じる。時刻は打っている途中なので閉じない
        if (next.date !== custom.date) setPicker(undefined);
      }}
      onChangeCalendarMonth={setMonth}
      onToggleCustomPicker={(which) => setPicker((p) => (p === which ? undefined : which))}
      onSelectPreset={(preset) => {
        setEmoji(preset.emoji);
        setText(preset.text ?? "");
      }}
      onSave={() => void save()}
      onClear={() => void clear()}
    />
  );
}

/**
 * 選んだ期限を絶対の時刻にする。`none` と、日時が揃っていない `custom` は null（消えない）。
 *
 * 「今日」はその日の終わり、「今週」は次の日曜の始まり（Slack と同じで、週の終わりに消える）。
 */
export function expiresAt(expiry: StatusExpiry, custom: StatusExpiryCustom, now: Date): Date | null {
  switch (expiry) {
    case "none":
      return null;
    case "30m":
      return new Date(now.getTime() + 30 * 60 * 1000);
    case "1h":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "4h":
      return new Date(now.getTime() + 4 * 60 * 60 * 1000);
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    case "week":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - now.getDay()));
    case "custom": {
      const date = fromISODate(custom.date);
      const time = normalizeTime(custom.time);
      if (!date || !time) return null;
      const [hour, minute] = time.split(":").map(Number);
      date.setHours(hour, minute, 0, 0);
      return date;
    }
  }
}
