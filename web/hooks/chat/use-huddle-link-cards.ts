"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { HuddleLinkCardView } from "@/components/chat/types";
import { useSessionState } from "@/hooks/auth/use-session";
import { useOrigin } from "@/hooks/use-origin";
import type { Message } from "@/lib/api/types.gen";
import { huddleLinkCardTable, huddleLinkRoomsIn } from "@/lib/chat/views/huddles";
import { toMemberNames } from "@/lib/chat/views/members";
import { canPost } from "@/lib/chat/views/permissions";

import { useChatContext } from "./use-chat-context";
import { useChatState } from "./use-chat-store";
import { useAvatarUrls } from "./use-media";

/**
 * 本文に貼られたハドルのリンクのカード（ADR 0067 決定 2）を、ルームごとの表にして返す。タイムラインとスレッドのパネルで使う。
 *
 * 手元のストアにあるルーム（サイドバーのルーム・開いたルーム）は、ストアの生きた状態から描く。
 * ないルームだけを、見る人の権限でまとめて取りにいく（取った時点のまま。押せばプレビューが読み直す）。
 */
export function useHuddleLinkCardTable(
  messages: readonly Message[] | undefined,
  currentWorkspaceId: string,
): Record<string, HuddleLinkCardView> {
  const { huddleLinkCards, huddle } = useChatContext();
  const origin = useOrigin();
  const roomIds = useMemo(() => (origin ? huddleLinkRoomsIn(messages ?? [], origin) : []), [messages, origin]);

  const rooms = useChatState((s) => s.rooms);
  const missing = roomIds.filter((id) => rooms[id] === undefined).join(" ");
  useEffect(() => {
    if (missing !== "") huddleLinkCards.request(missing.split(" "));
  }, [huddleLinkCards, missing]);
  const get = () => huddleLinkCards.getSnapshot();
  const fetched = useSyncExternalStore(huddleLinkCards.subscribe, get, get);

  // WebRTC のないブラウザと、サーバーに Cloudflare の設定がないときは、ボタンを出さない（ADR 0066 決定 15）
  const huddlesEnabled = useChatState((s) => s.features?.huddles ?? false) && huddle !== null;
  const workspaces = useChatState((s) => s.workspaces.list);
  const members = useChatState((s) => s.members[currentWorkspaceId]);
  const { state: sessionState } = useSessionState();
  const meId = sessionState.status === "signed_in" ? sessionState.user.id : undefined;

  const participantIds = roomIds.flatMap((id) =>
    (rooms[id]?.huddle ?? fetched[id]?.huddle)?.participants.map((p) => p.user_id) ?? [],
  );
  const avatarUrls = useAvatarUrls(participantIds);

  return useMemo(() => {
    const names = toMemberNames(members?.list);
    const workspaceNames = Object.fromEntries(workspaces.map((w) => [w.id, w.name]));
    return huddleLinkCardTable(roomIds, {
      rooms,
      fetched,
      meId,
      huddlesEnabled,
      canJoin: canPost,
      currentWorkspaceId,
      workspaceNames,
      names,
      avatarUrls,
    });
  }, [roomIds, rooms, fetched, meId, huddlesEnabled, currentWorkspaceId, workspaces, members, avatarUrls]);
}
