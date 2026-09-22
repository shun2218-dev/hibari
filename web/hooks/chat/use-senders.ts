"use client";

import { useCallback, useMemo } from "react";

import type { Message } from "@/lib/api/types.gen";

/**
 * 一覧にいない人（外された人）のカードとパネルに出す名前と handle（ADR 0050 決定 5）。
 * メッセージの送信者の値から取る。
 */
export type ProfileSender = { id: string; display_name: string; handle: string };

/** タイムラインのメッセージから、送信者の名前と handle の表を作る（一覧にいない人の手がかり）。 */
export function useSenders(messages: readonly Message[] | undefined): (userId: string) => ProfileSender | undefined {
  const table = useMemo(() => {
    const t = new Map<string, ProfileSender>();
    for (const m of messages ?? []) t.set(m.sender.id, m.sender);
    return t;
  }, [messages]);
  return useCallback((userId: string) => table.get(userId), [table]);
}
