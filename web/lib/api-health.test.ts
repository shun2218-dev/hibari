import { describe, expect, it, vi } from "vitest";

import { fetchApiHealth } from "./api-health";

describe("fetchApiHealth", () => {
  it.each([
    [200, "ok"],
    [503, "unavailable"],
  ] as const)("maps HTTP %d to %s", async (status, want) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status }));

    await expect(fetchApiHealth("http://api.test", fetchImpl)).resolves.toBe(want);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/healthz",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("returns unreachable when the request fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(fetchApiHealth("http://api.test", fetchImpl)).resolves.toBe("unreachable");
  });

  it("gives up after the timeout", async () => {
    // signal が中断されるまで応答しない API を模す。
    const fetchImpl = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );

    await expect(fetchApiHealth("http://api.test", fetchImpl, 10)).resolves.toBe("unreachable");
  });
});
