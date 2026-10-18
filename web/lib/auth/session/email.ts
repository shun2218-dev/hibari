import type {
  EmailVerificationRequest,
  OneTimeTokenRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  User,
} from "@/lib/api/types.gen";

import type { SessionCore } from "./core";

/**
 * メールアドレスの確認とパスワードの再設定（ADR 0007 / 0053）。リンクは別のブラウザで開かれることもある。
 */
export function createEmail(core: SessionCore) {
  const { dropAccessToken, publicRequest, refresh, request, setState, signOutLocally } = core;

  /**
   * refresh して検証の状態を載せた Access Token を取り直し、user を読み直す。
   * 検証済みなら確認待ちを解く。未検証のままなら、確認待ちかどうかは変えない（止めるのはサーバーの応答だけ）。
   */
  async function reloadVerification(): Promise<void> {
    dropAccessToken();
    await refresh();
    const user = await request<User>("GET", "/api/v1/users/me");
    if (core.state.status !== "signed_in") return;
    const emailUnverified = core.state.emailUnverified && !user.email_verified;
    setState({ status: "signed_in", user, ...(emailUnverified ? { emailUnverified } : {}) });
  }

  return {
    /** アカウントがなくても成功する（存在の有無を明かさない）。失敗は 429 rate-limited など。 */
    requestPasswordReset(input: PasswordResetRequest): Promise<void> {
      return publicRequest("password-reset/request", input);
    },

    /**
     * 成功すると、サーバーはそのユーザーの全セッションを失効させるので、このタブもログアウトした状態にする
     * （手元の Access Token は期限まで検証を通ってしまう。ADR 0007）。リンクの持ち主が別のアカウントでも、ログインし直せば済むので区別しない。
     * リンクが使えなければ 400 invalid-one-time-token、パスワードが制約を満たさなければ 422 validation-error（トークンは消費されない）。
     */
    async resetPassword(input: PasswordResetConfirmRequest): Promise<void> {
      await publicRequest("password-reset/confirm", input);
      signOutLocally();
    },

    /**
     * リンクのトークンでメールアドレスを確認する。
     * ログイン中なら refresh して user を取り直す。手元の Access Token は検証の前のもので、chat の API に止められるため（ADR 0053 決定 2）。
     * トークンの持ち主がいまのユーザーとは限らないので、email_verified を決め打ちで書き換えない。
     */
    async verifyEmail(input: OneTimeTokenRequest): Promise<void> {
      await publicRequest("verify-email/confirm", input);
      if (core.state.status !== "signed_in") return;
      try {
        await reloadVerification();
      } catch {
        // 確認そのものは済んでいる。表示が古いだけなので、次に user を取ったときか 403 を受けたときに直る。
      }
    },

    /**
     * 確認メールを送り直す。`next` は検証のあとに進む先で、リンクに載る（ADR 0053 決定 3）。
     * 失敗は ApiError（429 rate-limited、ログインしていなければ 401）。
     */
    requestEmailVerification(input: EmailVerificationRequest = {}): Promise<void> {
      return request<void>("POST", "/api/v1/auth/verify-email/request", input.next ? input : undefined);
    },

    /**
     * 確認待ちのまま、別のタブや端末で検証を済ませたかを確かめる。済んでいれば確認待ちを解く。
     * 確認待ちの画面が、タブに戻ってきたときに呼ぶ。通信の失敗は投げる。
     */
    recheckEmailVerification(): Promise<void> {
      return reloadVerification();
    },

    // ---- 設定（ADR 0019 / 0020 / 0031） ----
  };
}

export type Email = ReturnType<typeof createEmail>;
