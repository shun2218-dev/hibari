"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { MediaState, MediaStore } from "@/lib/chat/media/media";

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
