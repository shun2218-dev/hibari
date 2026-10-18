import { describe, expect, it } from "vitest";

import { apiErrorFrom } from "./error";
import { PROBLEM_TYPE_PREFIX } from "./types.gen";

describe("apiErrorFrom", () => {
  it("reads the problem type without the prefix, field errors and Retry-After", async () => {
    const res = new Response(
      JSON.stringify({
        type: PROBLEM_TYPE_PREFIX + "validation-error",
        title: "Invalid input",
        status: 422,
        request_id: "req-1",
        errors: [{ field: "handle", reason: "invalid_format" }],
      }),
      { status: 422, headers: { "Content-Type": "application/problem+json", "Retry-After": "5" } },
    );

    const err = await apiErrorFrom(res);

    expect(err).toMatchObject({
      status: 422,
      type: "validation-error",
      fieldErrors: [{ field: "handle", reason: "invalid_format" }],
      retryAfterSeconds: 5,
      requestId: "req-1",
    });
  });

  it.each([
    ["an HTML error page from a proxy", new Response("<h1>Bad Gateway</h1>", { status: 502, headers: { "Content-Type": "text/html" } })],
    ["a broken problem body", new Response("{", { status: 500, headers: { "Content-Type": "application/problem+json" } })],
    ["a problem type from elsewhere", new Response(JSON.stringify({ type: "about:blank", title: "x", status: 400 }), { status: 400, headers: { "Content-Type": "application/problem+json" } })],
  ])("keeps only the status for %s", async (_name, res) => {
    const err = await apiErrorFrom(res);

    expect(err.status).toBe(res.status);
    expect(err.type).toBeUndefined();
    expect(err.fieldErrors).toEqual([]);
    expect(err.retryAfterSeconds).toBeUndefined();
  });
});
