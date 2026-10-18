import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/error";
import { PROBLEM_TYPE_PREFIX } from "@/lib/api/types.gen";

import { forgotPasswordErrorMessage, resetPasswordErrorMessage } from "./password-reset-error";

function apiError(status: number, type: string, errors?: { field: string; reason: string }[]) {
  return new ApiError(status, { type: PROBLEM_TYPE_PREFIX + type, title: "x", status, errors });
}

describe("forgotPasswordErrorMessage", () => {
  it("explains the rate limit", () => {
    expect(forgotPasswordErrorMessage(apiError(429, "rate-limited"))).toMatch(/再設定メールの送信が多すぎます/);
  });

  it.each([
    ["a server error", apiError(500, "internal")],
    ["a network failure", new TypeError("fetch failed")],
  ])("leaves %s to the caller", (_name, err) => {
    expect(forgotPasswordErrorMessage(err)).toBeUndefined();
  });
});

describe("resetPasswordErrorMessage", () => {
  it.each([
    ["too_short", "パスワードは8文字以上にしてください。"],
    ["too_long", "パスワードは128文字以内にしてください。"],
    ["required", "パスワードを入力してください。"],
  ])("uses the same wording as signup for %s", (reason, message) => {
    expect(resetPasswordErrorMessage(apiError(422, "validation-error", [{ field: "password", reason }]))).toBe(message);
  });

  it.each([
    ["an unusable link", apiError(400, "invalid-one-time-token")],
    ["an unknown reason", apiError(422, "validation-error", [{ field: "password", reason: "new_reason" }])],
    ["a network failure", new TypeError("fetch failed")],
  ])("leaves %s to the caller", (_name, err) => {
    expect(resetPasswordErrorMessage(err)).toBeUndefined();
  });
});
