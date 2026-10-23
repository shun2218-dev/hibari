import { apiErrorFrom } from "@/lib/api/error";
import type { LoginRequest, RegisterRequest, TokenResponse } from "@/lib/api/types.gen";

import type { SessionCore, SessionOptions } from "./core";

/**
 * 登録・ログイン・ログアウト（ADR 0010）。どれも Refresh Token の Cookie を使う。
 */
export function createAccount(core: SessionCore, { beforeLogout }: Pick<SessionOptions, "beforeLogout"> = {}) {
  const { acceptTokens, authRequest, setState, signOutLocally } = core;

  async function signIn(path: "login" | "register", body: LoginRequest | RegisterRequest) {
    const res = await authRequest(path, body);
    if (!res.ok) throw await apiErrorFrom(res);
    const tokens = (await res.json()) as TokenResponse;
    acceptTokens(tokens);
    // login と register は必ず user を返す。
    setState({ status: "signed_in", user: tokens.user! });
  }

  return {
    /** 失敗したら ApiError（401 invalid-credentials / 429 rate-limited など）を投げる。 */
    login(input: LoginRequest): Promise<void> {
      return signIn("login", input);
    },

    /** 登録すると同時にログインする（ADR 0010）。`next` は確認メールのリンクに載る戻り先（ADR 0053 決定 3）。 */
    register(input: RegisterRequest): Promise<void> {
      return signIn("register", input);
    },

    /**
     * このセッションだけを失効させる。サーバーに届かなくても、この画面ではログアウトした状態にする
     * （Cookie は残るので、次に開いたときに refresh で戻る）。
     */
    async logout(): Promise<void> {
      // 失効させる前に片付ける（失効の後だと、片付けに要る状態がもう画面から消えている）
      await beforeLogout?.().catch(() => {});
      try {
        await authRequest("logout");
      } catch {
        // 上のとおり、届かなくても画面の状態は変える。
      }
      signOutLocally();
    },
  };
}

export type Account = ReturnType<typeof createAccount>;
