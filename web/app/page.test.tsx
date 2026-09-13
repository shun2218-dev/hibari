import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

// connection() は Next.js のリクエストの中でしか呼べないので、テストでは何もしない関数にする。
vi.mock("next/server", () => ({ connection: vi.fn().mockResolvedValue(undefined) }));

// Vitest は async Server Component を描画できないので、await した結果の JSX を描画する。
async function renderHome() {
  render(await Home());
}

describe("Home", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test/");
  });

  it.each([
    [200, "API: ok"],
    [503, "API: unavailable"],
  ] as const)("shows the API health (HTTP %d)", async (status, text) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);

    await renderHome();

    expect(screen.getByRole("heading", { name: "hibari" })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/healthz", expect.anything());
  });

  it("shows unreachable when the API is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await renderHome();

    expect(screen.getByText("API: unreachable")).toBeInTheDocument();
  });
});
