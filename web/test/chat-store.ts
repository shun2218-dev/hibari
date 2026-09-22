import { createChatApi } from "@/lib/chat/api/chat-api";
import { createChatStore } from "@/lib/chat/store/chat-store";
import type { ChatStoreOptions } from "@/lib/chat/store/state";
import { createSession } from "@/lib/auth/session/auth-session";
import { message, naoki, room } from "@/test/chat-data";
import { type Handler, TEST_API_BASE, fakeApi, json, tokens } from "@/test/fake-api";

/**
 * ストア（lib/chat/store/）のテストの土台。偽の API につないだストアを作る。
 * スライスごとのテスト（slices/*.test.ts）が共有する。
 */
export function setup(routes: Record<string, Handler>, options: Partial<ChatStoreOptions> = {}) {
  const api = fakeApi({ "POST /api/v1/auth/refresh": () => tokens("at-1"), ...routes });
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  const store = createChatStore(createChatApi(session.request), { userId: naoki.id, ...options });
  return { api, store, requests: () => api.paths().filter((p) => !p.includes("/auth/")) };
}

/** テストの中の「自分」。setup が userId に渡すもの。 */
export const me = naoki.id;

export function body(init: RequestInit) {
  return JSON.parse(init.body as string);
}

export const msg = (seq: number, overrides: Parameters<typeof message>[1] = {}) => message(seq, { room_id: "r1", ...overrides });

export function page(messages: ReturnType<typeof message>[], lastChangeSeq: number, hasMore = false) {
  return json(200, { messages, has_more: hasMore, last_change_seq: lastChangeSeq });
}

/** r1（最新 3 件、既読 3）を開いた状態にする。 */
export async function opened(routes: Record<string, Handler> = {}, options: Partial<ChatStoreOptions> = {}) {
  const ctx = setup(
    {
      "GET /api/v1/workspaces/ws-1/rooms": () =>
        json(200, { rooms: [room("r0", "先頭"), room("r1", "雑談", { last_message_seq: 3, last_read_seq: 3, last_user_seq: 3, last_read_user_seq: 3 })] }),
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 3, last_read_seq: 3, last_user_seq: 3, last_read_user_seq: 3 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () => page([msg(1), msg(2), msg(3)], 3),
      "POST /api/v1/rooms/r1/read": (_url, init) => {
        const { seq } = body(init);
        return json(200, { last_read_seq: seq, last_read_user_seq: seq, unread_count: 0 });
      },
      ...routes,
    },
    options,
  );
  await ctx.store.loadRooms("ws-1");
  await ctx.store.openRoom("r1");
  return ctx;
}

export const created = (m: ReturnType<typeof message>) => ({ type: "message.created" as const, data: m });

export const seqs = (store: ReturnType<typeof setup>["store"]) =>
  store.getSnapshot().timelines.r1?.messages.map((m) => m.seq);
