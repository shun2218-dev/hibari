import type { UserProfile } from "@/lib/api/types.gen";
import { TYPING_TTL_MS } from "@/lib/chat/store/state";

import type { StoreCore } from "./core";

/**
 * 入力中（チャンネル。スレッドの入力中は threads）。
 */
export function createTyping(
  core: StoreCore,
) {
  const { now, typingTimers, update, userId } = core;

  function removeTyping(roomId: string, typingUserId: string) {
    const key = `${roomId}:${typingUserId}`;
    clearTimeout(typingTimers.get(key));
    typingTimers.delete(key);
    update((s) => {
      const list = s.typing[roomId];
      if (!list?.some((t) => t.user.id === typingUserId)) return s;
      const rest = list.filter((t) => t.user.id !== typingUserId);
      return { ...s, typing: { ...s.typing, [roomId]: rest.length > 0 ? rest : undefined } };
    });
  }

  function receiveTyping(roomId: string, user: UserProfile) {
    if (user.id === userId) return;
    const key = `${roomId}:${user.id}`;
    clearTimeout(typingTimers.get(key));
    typingTimers.set(key, setTimeout(() => removeTyping(roomId, user.id), TYPING_TTL_MS));
    update((s) => {
      const others = (s.typing[roomId] ?? []).filter((t) => t.user.id !== user.id);
      return { ...s, typing: { ...s.typing, [roomId]: [...others, { user, expiresAt: now() + TYPING_TTL_MS }] } };
    });
  }

  return {
    receiveTyping,
    removeTyping,
    actions: {},
  };
}

export type Typing = ReturnType<typeof createTyping>;
