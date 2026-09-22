import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { createSession } from "@/lib/auth/session";
import type { UploaderOptions } from "@/lib/chat/media/uploads";
import { ChatProvider } from "@/providers/chat-provider";
import { SessionProvider } from "@/providers/session-provider";

import { type Handler, TEST_API_BASE, fakeApi, json, testUser, tokens } from "./fake-api";
import { fakeSockets } from "./fake-socket";

/**
 * ログインした状態で、チャットのストアと一緒に描く。routes はログインと ws-ticket の分に足される（同じキーなら上書き）。
 * WebSocket は偽物で、sockets.last() でサーバーの役を演じる（購読には自動で成功の ack を返す）。
 */
export function renderWithChat(
  ui: ReactElement,
  routes: Record<string, Handler>,
  { upload }: { upload?: UploaderOptions } = {},
) {
  let tickets = 0;
  const api = fakeApi({
    "POST /api/v1/auth/refresh": () => tokens("at-1"),
    "GET /api/v1/users/me": () => json(200, testUser),
    "POST /api/v1/ws/ticket": () => json(200, { ticket: `ticket-${++tickets}`, expires_in: 30 }),
    // 画面に出す人のアバター。既定では誰も画像を設定していない
    "POST /api/v1/users/avatars": () => json(200, { avatars: {} }),
    ...routes,
  });
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  const sockets = fakeSockets({ autoAck: true });
  const result = render(
    <SessionProvider session={session}>
      <ChatProvider userId={testUser.id} transport={{ url: "ws://api.test/api/v1/ws", createSocket: sockets.createSocket, random: () => 0 }}
        upload={upload}
      >
        {ui}
      </ChatProvider>
    </SessionProvider>,
  );
  return { api, session, sockets, ...result };
}
