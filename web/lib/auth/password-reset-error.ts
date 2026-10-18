import { ApiError } from "@/lib/api/error";

import { fieldMessages } from "./signup-error";

/**
 * 再設定メールの依頼の失敗を、ForgotPasswordForm の `error` に出す文言にする。
 * それ以外（通信の失敗、500）は undefined を返し、呼び出し側に任せる。
 *
 * 回数制限はアカウントの有無に関係なく数える（internal/auth）ので、出してもアカウントの有無は分からない。
 */
export function forgotPasswordErrorMessage(err: unknown): string | undefined {
  if (err instanceof ApiError && err.type === "rate-limited") {
    return "再設定メールの送信が多すぎます。しばらく時間をおいてから再度お試しください。";
  }
  return undefined;
}

/**
 * 新しいパスワードが受け付けられなかったときの、ResetPasswordForm の `error` に出す文言。
 * 制約は登録と同じ（internal/auth の passwordProblem）なので、文言も登録と共有する。
 * リンクが使えない（invalid-one-time-token）のは別の画面にするので、ここでは扱わない。
 */
export function resetPasswordErrorMessage(err: unknown): string | undefined {
  if (!(err instanceof ApiError) || err.type !== "validation-error") return undefined;
  const messages = err.fieldErrors
    .filter((e) => e.field === "password")
    .map((e) => fieldMessages.password[e.reason])
    .filter((m): m is string => m !== undefined);
  return messages.length > 0 ? messages.join("") : undefined;
}
