"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { LinkCardState } from "@/lib/chat/format/link-cards";
import { type LinkTarget, linkKey, parseLinkKey } from "@/lib/chat/format/links";

import { useChatContext } from "./use-chat-context";

/**
 * 本文に貼られたパーマリンクのカードの中身（ADR 0040）。画面に出ているリンクを頼み、取れたものを返す。
 * 取り直さないので、同じリンクは 1 回しか取りにいかない。
 */
export function useLinkCards(links: readonly LinkTarget[]): LinkCardState {
  const { linkCards } = useChatContext();
  const key = links.map(linkKey).join(" ");
  useEffect(() => {
    if (key !== "") linkCards.request(key.split(" ").map(parseLinkKey));
  }, [linkCards, key]);
  const get = () => linkCards.getSnapshot();
  return useSyncExternalStore(linkCards.subscribe, get, get);
}
