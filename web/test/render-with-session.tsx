import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { createSession } from "@/lib/auth/session";
import { SessionProvider } from "@/lib/auth/session-provider";

import { type Handler, TEST_API_BASE, fakeApi } from "./fake-api";

/** 偽の API につないだセッションの中で描く。 */
export function renderWithSession(ui: ReactElement, routes: Record<string, Handler>) {
  const api = fakeApi(routes);
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  return { api, session, ...render(<SessionProvider session={session}>{ui}</SessionProvider>) };
}
