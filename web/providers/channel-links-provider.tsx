"use client";

import { createContext, type ReactNode } from "react";

import type { ChannelTable } from "@/lib/chat/format/channel-links";

/**
 * 本文の `<#ID>`（ADR 0062）を描くための、チャンネルの表とリンク先。
 *
 * 表はワークスペースで 1 つで、どのメッセージでも同じなので、メンションの名前のようにメッセージごとの props では運ばない。
 * 本文はタイムライン・スレッド・検索・「後で」・リンクのカードなど多くの所で描くので、そこを全部通すより、画面の根で 1 回配る。
 * Provider の外（部品の story など）では表が空になり、すべて「アクセスできないチャンネル」として描く。
 */
export type ChannelLinks = { channels: ChannelTable; href: (roomId: string) => string };

/** 値を読むフックは hooks/chat/ に置く（ADR 0060）。ここは作って配るだけ。 */
export const ChannelLinksContext = createContext<ChannelLinks>({ channels: {}, href: () => "#" });

export function ChannelLinksProvider({ value, children }: { value: ChannelLinks; children: ReactNode }) {
  return <ChannelLinksContext value={value}>{children}</ChannelLinksContext>;
}
