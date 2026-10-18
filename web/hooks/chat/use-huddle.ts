"use client";

import { useSyncExternalStore } from "react";

import type { HuddleCall, HuddleCallState } from "@/lib/chat/huddle/call";
import type { HuddleSurface, HuddleSurfaceStore } from "@/lib/chat/huddle/surface";

import { useChatContext } from "./use-chat-context";

const IDLE: HuddleCallState = { phase: "idle" };
const NONE: HuddleSurface = { kind: "none" };
const noop = () => () => {};

/** 音声のハドルの通話と画面の出し先（ADR 0066 追記 C）。WebRTC のないブラウザでは null。 */
export function useHuddle(): { call: HuddleCall; surface: HuddleSurfaceStore } | null {
  return useChatContext().huddle;
}

/** 通話の状態。通話を作っていなければ idle のまま。 */
export function useHuddleCall(): HuddleCallState {
  const huddle = useHuddle();
  return useSyncExternalStore(
    huddle?.call.subscribe ?? noop,
    () => huddle?.call.getSnapshot() ?? IDLE,
    () => IDLE,
  );
}

/** 画面の出し先（別のタブ・全画面・なし）。 */
export function useHuddleSurface(): HuddleSurface {
  const huddle = useHuddle();
  return useSyncExternalStore(
    huddle?.surface.subscribe ?? noop,
    () => huddle?.surface.getSnapshot() ?? NONE,
    () => NONE,
  );
}
