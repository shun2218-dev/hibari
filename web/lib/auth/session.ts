import { ApiError, apiErrorFrom } from "@/lib/api/error";
import type {
  AvatarUpload,
  AvatarUploadRequest,
  CompleteAvatarUploadRequest,
  LoginRequest,
  OneTimeTokenRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RegisterRequest,
  RevokeSessionsResponse,
  SessionList,
  TokenResponse,
  UpdateProfileRequest,
  User,
} from "@/lib/api/types.gen";

import { type LockManagerLike, singleFlight } from "./single-flight";

/**
 * 画面から見える認証の状態。Access Token は含めない（コンポーネントやログに渡らないように）。
 * - loading: 起動直後で、refresh の結果を待っている
 * - signed_out: Refresh Token がない、または使えない
 * - signed_in: Access Token を持っている
 */
export type SessionState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; user: User };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type SessionOptions = {
  /** getApiBaseUrl() の値（末尾のスラッシュなし）。 */
  baseUrl: string;
  fetch?: Fetch;
  /** 現在時刻（ミリ秒）。Access Token の期限の判定に使う。 */
  now?: () => number;
  locks?: LockManagerLike;
};

/** Access Token の期限が、この時間を切っていたら先に refresh する（時計のずれと通信時間の分の余裕）。 */
const EXPIRY_MARGIN_MS = 30_000;

/** Web Locks のロックの名前。オリジンごとに分かれるので、アプリの名前だけでよい。 */
const REFRESH_LOCK = "hibari:refresh";

export type Session = ReturnType<typeof createSession>;

/**
 * Web クライアントの認証の状態と、Access Token を付けた API の呼び出し。
 *
 * - Access Token はメモリにだけ持つ（localStorage に置かない。CLAUDE.md）。リロードしたら refresh で取り直す
 * - Refresh Token は httpOnly Cookie で、JS からは見えない。`X-Hibari-Client: web` を付けて Cookie 方式にする（ADR 0010）
 * - `useSyncExternalStore` で購読できる形（subscribe / getSnapshot）にする。スナップショットは状態が変わったときだけ作り直す
 */
export function createSession({ baseUrl, fetch: fetchImpl = fetch, now = Date.now, locks }: SessionOptions) {
  let state: SessionState = { status: "loading" };
  let accessToken: { value: string; expiresAt: number } | undefined;
  let restoring: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  function setState(next: SessionState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function signOutLocally() {
    accessToken = undefined;
    setState({ status: "signed_out" });
  }

  function acceptTokens(res: TokenResponse) {
    accessToken = { value: res.access_token, expiresAt: now() + res.expires_in * 1000 };
  }

  /**
   * Refresh Token の Cookie を使うエンドポイントの呼び出し。
   * API は別のオリジン（ポート違い）なので、Cookie の送受信に credentials: "include" が要る。
   */
  function authRequest(path: string, body?: unknown): Promise<Response> {
    return fetchImpl(`${baseUrl}/api/v1/auth/${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "X-Hibari-Client": "web",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /**
   * ログインしていなくても呼べるエンドポイント（パスワードの再設定、メールの確認）。
   * メールのリンクは別のブラウザで開かれることもあるので、Cookie も Access Token も使わない。
   */
  async function publicRequest(path: string, body: unknown): Promise<void> {
    const res = await fetchImpl(`${baseUrl}/api/v1/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await apiErrorFrom(res);
  }

  const refresh = singleFlight(
    REFRESH_LOCK,
    async () => {
      const res = await authRequest("refresh");
      if (res.status === 401) {
        // Refresh Token がない・期限切れ・失効済み。サーバーは Cookie を消させている。
        signOutLocally();
        throw await apiErrorFrom(res);
      }
      if (!res.ok) throw await apiErrorFrom(res);
      acceptTokens((await res.json()) as TokenResponse);
    },
    locks,
  );

  async function validAccessToken(): Promise<string> {
    if (!accessToken || accessToken.expiresAt - now() < EXPIRY_MARGIN_MS) {
      await refresh();
    }
    // refresh が成功していれば必ずある。
    return accessToken!.value;
  }

  /**
   * Access Token を付けて API を呼ぶ。401 なら 1 回だけ refresh して呼び直す。
   * 期限の前に失効したとき（別の端末でログアウトした、パスワードを再設定した）に 401 になる。
   */
  async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      return fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    };

    const token = await validAccessToken();
    let res = await send(token);
    if (res.status === 401) {
      // 401 が時間差で返ったとき、別のリクエストがすでに取り直した新しいトークンまで捨てない。
      if (accessToken?.value === token) accessToken = undefined;
      res = await send(await validAccessToken());
      if (res.status === 401) signOutLocally();
    }
    return res;
  }

  /**
   * JSON を送って JSON を受け取る。2xx 以外は ApiError を投げる。
   * ボディのない成功（204、202 の verify-email/request など）は undefined を返す。
   */
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await authorizedFetch(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await apiErrorFrom(res);
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }

  async function signIn(path: "login" | "register", body: LoginRequest | RegisterRequest) {
    const res = await authRequest(path, body);
    if (!res.ok) throw await apiErrorFrom(res);
    const tokens = (await res.json()) as TokenResponse;
    acceptTokens(tokens);
    // login と register は必ず user を返す。
    setState({ status: "signed_in", user: tokens.user! });
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): SessionState {
      return state;
    },

    /**
     * 起動時に 1 回だけ、Cookie の Refresh Token からログイン状態を戻す。何度呼んでも同じ Promise を返す。
     * /dev/preview のように認証の要らない画面では呼ばない（ルートのレイアウトではなく、認証を使うページが呼ぶ）。
     *
     * サーバーに届かないときは loading のまま投げる。ログアウトしたと誤って扱わない。
     */
    restore(): Promise<void> {
      restoring ??= (async () => {
        try {
          await refresh();
          const user = await request<User>("GET", "/api/v1/users/me");
          setState({ status: "signed_in", user });
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            signOutLocally();
            return;
          }
          restoring = undefined;
          throw err;
        }
      })();
      return restoring;
    },

    /** 失敗したら ApiError（401 invalid-credentials / 429 rate-limited など）を投げる。 */
    login(input: LoginRequest): Promise<void> {
      return signIn("login", input);
    },

    /** 登録すると同時にログインする（ADR 0010）。 */
    register(input: RegisterRequest): Promise<void> {
      return signIn("register", input);
    },

    /**
     * このセッションだけを失効させる。サーバーに届かなくても、この画面ではログアウトした状態にする
     * （Cookie は残るので、次に開いたときに refresh で戻る）。
     */
    async logout(): Promise<void> {
      try {
        await authRequest("logout");
      } catch {
        // 上のとおり、届かなくても画面の状態は変える。
      }
      signOutLocally();
    },

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
     * ログイン中なら user を取り直す（トークンの持ち主がいまのユーザーとは限らないので、email_verified を決め打ちで書き換えない）。
     */
    async verifyEmail(input: OneTimeTokenRequest): Promise<void> {
      await publicRequest("verify-email/confirm", input);
      if (state.status !== "signed_in") return;
      try {
        setState({ status: "signed_in", user: await request<User>("GET", "/api/v1/users/me") });
      } catch {
        // 確認そのものは済んでいる。表示が古いだけなので、次に user を取ったときに直る。
      }
    },

    // ---- 設定（ADR 0019 / 0020 / 0031） ----

    /**
     * 表示名とハンドルを変える。応答の user で画面の状態も進める。
     * 失敗したら ApiError（409 handle-taken、422 validation-error）を投げる。
     */
    async updateProfile(input: UpdateProfileRequest): Promise<void> {
      const user = await request<User>("PATCH", "/api/v1/users/me", input);
      setState({ status: "signed_in", user });
    },

    /** アバター画像の署名付き PUT URL を発行する（中身はサーバーを経由しない。ADR 0020）。 */
    createAvatarUpload(input: AvatarUploadRequest): Promise<AvatarUpload> {
      return request<AvatarUpload>("POST", "/api/v1/users/me/avatar", input);
    },

    /** PUT したオブジェクトを HEAD で検証し、プロフィールに反映する。 */
    async completeAvatarUpload(input: CompleteAvatarUploadRequest): Promise<void> {
      const user = await request<User>("POST", "/api/v1/users/me/avatar/complete", input);
      setState({ status: "signed_in", user });
    },

    /** 画像を外す（頭文字の表示に戻る）。 */
    async deleteAvatar(): Promise<void> {
      const user = await request<User>("DELETE", "/api/v1/users/me/avatar");
      setState({ status: "signed_in", user });
    },

    /** ログイン中のセッション（= 端末）の一覧。last_used_at の新しい順（ADR 0019）。 */
    listSessions(): Promise<SessionList> {
      return request<SessionList>("GET", "/api/v1/auth/sessions");
    },

    /** セッションを 1 つ失効させる。他人のものやすでに失効したものは 404。 */
    revokeSession(sessionId: string): Promise<void> {
      return request<void>("DELETE", `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`);
    },

    /** いま使っているセッション以外をすべて失効させる。 */
    revokeOtherSessions(): Promise<RevokeSessionsResponse> {
      return request<RevokeSessionsResponse>("DELETE", "/api/v1/auth/sessions");
    },

    /**
     * 手元の Access Token を捨てて refresh し、セッションがまだ有効かを確かめる。
     *
     * WebSocket がセッションの失効（close コード 4001）で切られたときに使う。REST の Access Token は期限まで検証を通る
     * （ADR 0007）ので、手元のトークンで ws-ticket を発行し直せてしまい、接続の失敗を繰り返す。refresh すれば失効が分かる。
     *
     * 有効なら true、失効していたら signed_out にして false を返す。通信の失敗は投げる（ログアウトしたと取り違えない）。
     */
    async revalidate(): Promise<boolean> {
      accessToken = undefined;
      try {
        await refresh();
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return false;
        throw err;
      }
    },

    request,
  };
}
