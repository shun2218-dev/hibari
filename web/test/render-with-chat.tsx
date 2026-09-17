import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { createSession } from "@/lib/auth/session";
import { SessionProvider } from "@/lib/auth/session-provider";
import { ChatProvider } from "@/lib/chat/chat-provider";

import { type Handler, TEST_API_BASE, fakeApi, json, testUser, tokens } from "./fake-api";

/** ログインした状態で、チャットのストアと一緒に描く。routes はログインの分に足される（同じキーなら上書き）。 */
export function renderWithChat(ui: ReactElement, routes: Record<string, Handler>) {
  const api = fakeApi({
    "POST /api/v1/auth/refresh": () => tokens("at-1"),
    "GET /api/v1/users/me": () => json(200, testUser),
    ...routes,
  });
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  const result = render(
    <SessionProvider session={session}>
      <ChatProvider>{ui}</ChatProvider>
    </SessionProvider>,
  );
  return { api, session, ...result };
}
