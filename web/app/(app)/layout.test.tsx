import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_API_BASE, json, problem, testUser, tokens } from "@/test/fake-api";
import { FakeSocket } from "@/test/fake-socket";
import { renderWithSession } from "@/test/render-with-session";

import AppLayout from "./layout";
import HomePage from "./page";

const nav = vi.hoisted(() => ({ router: { replace: vi.fn() }, pathname: "/" }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, usePathname: () => nav.pathname }));

const signedIn = {
  "POST /api/v1/auth/refresh": () => tokens("at-1"),
  "GET /api/v1/users/me": () => json(200, testUser),
  "POST /api/v1/ws/ticket": () => json(200, { ticket: "ticket-1", expires_in: 30 }),
};

const sockets: FakeSocket[] = [];

describe("AppLayout", () => {
  beforeEach(() => {
    nav.router.replace.mockReset();
    nav.pathname = "/";
    window.history.replaceState(null, "", "/");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", TEST_API_BASE);
    sockets.length = 0;
    vi.stubGlobal(
      "WebSocket",
      class extends FakeSocket {
        constructor(url: string) {
          super(url, true);
          sockets.push(this);
        }
      },
    );
  });

  it("renders the page once the session is restored", async () => {
    renderWithSession(
      <AppLayout>
        <p>protected</p>
      </AppLayout>,
      signedIn,
    );

    expect(await screen.findByText("protected")).toBeInTheDocument();
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("sends a signed-out user to the login page and remembers where they were", async () => {
    nav.pathname = "/w/123";
    window.history.replaceState(null, "", "/w/123?room=abc");

    renderWithSession(
      <AppLayout>
        <p>protected</p>
      </AppLayout>,
      { "POST /api/v1/auth/refresh": () => problem(401, "invalid-refresh-token") },
    );

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/login?next=%2Fw%2F123%3Froom%3Dabc"));
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
  });

  it("goes back to the login page after logging out", async () => {
    renderWithSession(
      <AppLayout>
        <HomePage />
      </AppLayout>,
      {
        ...signedIn,
        "GET /api/v1/workspaces": () => json(200, { workspaces: [] }),
        "POST /api/v1/auth/logout": () => new Response(null, { status: 204 }),
      },
    );

    // ワークスペースが 0 件の画面のログアウト
    await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/login"));
  });

  it("connects the websocket while signed in and closes it after logging out", async () => {
    renderWithSession(
      <AppLayout>
        <HomePage />
      </AppLayout>,
      {
        ...signedIn,
        "GET /api/v1/workspaces": () => json(200, { workspaces: [] }),
        "POST /api/v1/auth/logout": () => new Response(null, { status: 204 }),
      },
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(sockets[0].url).toBe("ws://api.test/api/v1/ws?ticket=ticket-1");

    await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));

    await waitFor(() => expect(sockets[0].closed).toBe(true));
  });
});
