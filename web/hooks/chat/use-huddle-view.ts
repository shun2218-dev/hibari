"use client";

import { useMemo } from "react";

import type { HuddlePreviewView, HuddleScreenView, UserRef } from "@/components/chat/types";
import { useSessionState } from "@/hooks/auth/use-session";
import type { Room } from "@/lib/api/types.gen";
import type { HuddleCallState } from "@/lib/chat/huddle/call";
import { toHuddlePreviewView, toHuddleScreenView } from "@/lib/chat/views/huddles";
import { toMemberNames } from "@/lib/chat/views/members";

import { useChatState } from "./use-chat-store";
import { useHuddleCall } from "./use-huddle";
import { useAvatarUrls } from "./use-media";

/**
 * 通話しているハドルの、画面と帯に出すもの（ADR 0066 追記 B・C）。
 * ルームは通話のもの（開いているルームとは限らない。別のワークスペースのこともある）。
 */
export function useHuddleView(): {
  call: HuddleCallState;
  room: Room | undefined;
  self: UserRef | undefined;
  names: Record<string, string>;
  preview?: HuddlePreviewView;
  screen?: HuddleScreenView;
} {
  const call = useHuddleCall();
  const roomId = call.phase === "idle" ? undefined : call.roomId;
  const room = useChatState((s) => (roomId ? s.rooms[roomId] : undefined));
  const members = useChatState((s) => (room ? s.members[room.workspace_id] : undefined));
  const { state: sessionState } = useSessionState();
  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;

  const huddle = room?.huddle;
  const userIds = useMemo(
    () => [
      ...(me ? [me.id] : []),
      ...(huddle?.participants.map((p) => p.user_id) ?? []),
      ...(huddle?.joining_soon ?? []),
    ],
    [me, huddle],
  );
  const avatarUrls = useAvatarUrls(userIds);
  const names = useMemo(() => toMemberNames(members?.list), [members]);
  const self = useMemo<UserRef | undefined>(
    () => (me ? { id: me.id, name: me.display_name, avatarUrl: avatarUrls[me.id] ?? me.avatar_url ?? undefined } : undefined),
    [me, avatarUrls],
  );

  const preview = useMemo(
    () => (call.phase === "preview" && room && self ? toHuddlePreviewView(room, call, self) : undefined),
    [call, room, self],
  );
  const screen = useMemo(
    () => (call.phase === "call" && room && self ? toHuddleScreenView(room, call, { me: self, names, avatarUrls }) : undefined),
    [call, room, self, names, avatarUrls],
  );
  return { call, room, self, names, preview, screen };
}
