import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { json, problem, testUser, tokens } from "@/test/fake-api";
import { renderWithSession } from "@/test/render-with-session";

import AppLayout from "./layout";
import HomePage from "./page";

const nav = vi.hoisted(() => ({ router: { replace: vi.fn() }, pathname: "/" }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, usePathname: () => nav.pathname }));

const signedIn = {
  "POST /api/v1/auth/refresh": () => tokens("at-1"),
  "GET /api/v1/users/me": () => json(200, testUser),
};

describe("AppLayout", () => {
  beforeEach(() => {
    nav.router.replace.mockReset();
    nav.pathname = "/";
    window.history.replaceState(null, "", "/");
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
      { ...signedIn, "POST /api/v1/auth/logout": () => new Response(null, { status: 204 }) },
    );

    expect(await screen.findByText(/でログインしています/)).toHaveTextContent("佐藤 直樹（@naoki）でログインしています");
    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/login"));
  });
});
