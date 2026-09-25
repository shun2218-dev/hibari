"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { Message } from "@/lib/api/types.gen";
import type { MediaState, MediaStore } from "@/lib/chat/media/media-store";
import { linkPreviewRefs } from "@/lib/chat/views/message";

import { useChatContext } from "./use-chat-context";

export function useMedia(): MediaStore {
  return useChatContext().media;
}

/** 画像の URL の一部を購読する。select の決まりは useChatState と同じ。 */
export function useMediaState<T>(select: (state: MediaState) => T): T {
  const media = useMedia();
  const get = () => select(media.getSnapshot());
  return useSyncExternalStore(media.subscribe, get, get);
}

/**
 * 画面に出すユーザーのアバターの URL を頼み、user_id → URL の表を返す。
 * ID の並びや重複が違うだけなら頼み直さない。
 */
export function useAvatarUrls(userIds: readonly string[]): MediaState["avatars"] {
  const media = useMedia();
  const key = [...new Set(userIds)].sort().join(" ");
  useEffect(() => {
    if (key !== "") media.requestAvatars(key.split(" "));
  }, [media, key]);
  return useMediaState((s) => s.avatars);
}

/**
 * 画面に出すメッセージのリンクのプレビュー（ADR 0065）の、画像とアイコンの URL を頼み、preview_id → URL の表を返す。
 * 同じプレビューは 1 回しか取りにいかない（media-store）。
 */
export function useLinkPreviewUrls(messages: readonly Message[] | undefined): MediaState["linkPreviews"] {
  const media = useMedia();
  const refs = useMemo(() => linkPreviewRefs(messages ?? []), [messages]);
  useEffect(() => {
    if (refs.length > 0) media.requestLinkPreviewUrls(refs);
  }, [media, refs]);
  return useMediaState((s) => s.linkPreviews);
}
