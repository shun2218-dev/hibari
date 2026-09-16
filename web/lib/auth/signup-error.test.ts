import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/error";
import { type Problem, PROBLEM_TYPE_PREFIX } from "@/lib/api/types.gen";

import { signupErrorMessage } from "./signup-error";

function apiError(status: number, type: string, errors?: Problem["errors"]) {
  return new ApiError(status, { type: PROBLEM_TYPE_PREFIX + type, title: "x", status, errors });
}

describe("signupErrorMessage", () => {
  it.each([
    [apiError(409, "email-taken"), "このメールアドレスはすでに登録されています。"],
    [apiError(409, "handle-taken"), "このハンドルはすでに使われています。"],
    [apiError(429, "rate-limited"), "登録の試行が多すぎます。しばらく時間をおいてから再度お試しください。"],
  ])("explains %o", (err, message) => {
    expect(signupErrorMessage(err)).toBe(message);
  });

  it("lists every field error in the order of the form", () => {
    const err = apiError(422, "validation-error", [
      { field: "password", reason: "too_short" },
      { field: "handle", reason: "invalid_format" },
    ]);

    expect(signupErrorMessage(err)).toBe(
      "ハンドルは3〜32文字の半角英数字と _ で入力してください。パスワードは8文字以上にしてください。",
    );
  });

  it.each([
    ["a network failure", new TypeError("fetch failed")],
    ["a server error", apiError(500, "internal")],
    ["an unknown reason", apiError(422, "validation-error", [{ field: "handle", reason: "something_new" }])],
  ])("leaves %s to the caller", (_name, err) => {
    expect(signupErrorMessage(err)).toBeUndefined();
  });
});
