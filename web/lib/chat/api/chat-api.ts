import type { Session } from "@/lib/auth/session/auth-session";

import { createWorkspaceApi } from "./workspaces";
import { createInviteApi } from "./invites";
import { createRoomApi } from "./rooms";
import { createMessageApi } from "./messages";
import { createThreadApi } from "./threads";
import { createPinApi } from "./pins";
import { createSavedApi } from "./saved";
import { createActivityApi } from "./activity";
import { createMediaApi } from "./media";
import { createRealtimeApi } from "./realtime";

/**
 * チャットの REST API。パスとリクエスト・レスポンスの型の対応だけを持ち、状態は持たない。
 * 失敗は session.request が ApiError で投げる。
 *
 * リソースごとのファイル（workspaces / rooms / messages など）に分けてあり、ここは 1 つにまとめるだけ（ADR 0060 決定 5）。
 */
export function createChatApi(request: Session["request"]) {
  return {
    ...createWorkspaceApi(request),
    ...createInviteApi(request),
    ...createRoomApi(request),
    ...createMessageApi(request),
    ...createThreadApi(request),
    ...createPinApi(request),
    ...createSavedApi(request),
    ...createActivityApi(request),
    ...createMediaApi(request),
    ...createRealtimeApi(request),
  };
}

export type ChatApi = ReturnType<typeof createChatApi>;
