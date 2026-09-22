import { ApiError, apiErrorFrom } from "@/lib/api/error";
import type { TokenResponse, User } from "@/lib/api/types.gen";

import { type LockManagerLike, singleFlight } from "@/lib/auth/single-flight";

/**
 * 画面から見える認証の状態。Access Token は含めない（コンポーネントやログに渡らないように）。
 * - loading: 起動直後で、refresh の結果を待っている
 * - signed_out: Refresh Token がない、または使えない
 * - signed_in: Access Token を持っている。`emailUnverified` が true なら、email を検証するまで chat を使えない（ADR 0053）
 */
export type SessionState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; user: User; emailUnverified?: boolean };

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

/**
 * セッションの土台。Access Token をメモリに持ち、期限が近ければ先に refresh し、API の呼び出しに付ける（ADR 0010 / 0024）。
 *
 * - Access Token はメモリにだけ持つ（localStorage に置かない。CLAUDE.md）。リロードしたら refresh で取り直す
 * - Refresh Token は httpOnly Cookie で、JS からは見えない。`X-Hibari-Client: web` を付けて Cookie 方式にする（ADR 0010）
 * - `useSyncExternalStore` で購読できる形（subscribe / getSnapshot）にする。スナップショットは状態が変わったときだけ作り直す
 *
 * エンドポイントごとの呼び出し（ログイン・メールの確認・プロフィール・デバイス）は、これを受け取る別のファイルに分けてある。
 */
export function createSessionCore({ baseUrl, fetch: fetchImpl = fetch, now = Date.now, locks }: SessionOptions) {
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

  /**
   * chat の API が email-unverified で止められたことを覚える（ADR 0053 決定 3）。
   *
   * `user.email_verified` からは決めない。検証を外した開発環境（AUTH_REQUIRE_VERIFIED_EMAIL=false）では、
   * 未検証でも chat を使えるので、止めるかどうかはサーバーの応答だけを根拠にする。
   */
  function markEmailUnverified() {
    if (state.status !== "signed_in" || state.emailUnverified) return;
    setState({ ...state, emailUnverified: true });
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
   *
   * 403 email-unverified のときも 1 回だけ refresh して呼び直す。別のタブで検証を済ませていれば、
   * 手元のトークンが検証の前のものなだけなので、取り直せば通る（ADR 0053 決定 2）。それでも止められたら確認待ちにする。
   */
  async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      return fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    };

    let token = await validAccessToken();
    let res = await send(token);
    if (res.status === 401) {
      // 401 が時間差で返ったとき、別のリクエストがすでに取り直した新しいトークンまで捨てない。
      if (accessToken?.value === token) accessToken = undefined;
      token = await validAccessToken();
      res = await send(token);
      if (res.status === 401) signOutLocally();
    }
    if (await isEmailUnverified(res)) {
      // すでに確認待ちなら取り直さない（止められた画面から出ていく残りのリクエストで refresh を繰り返さない）。
      if (state.status === "signed_in" && state.emailUnverified) return res;
      // 401 と同じく、別のリクエストが取り直したトークンは捨てずに使う。
      if (accessToken?.value === token) accessToken = undefined;
      res = await send(await validAccessToken());
      if (await isEmailUnverified(res)) markEmailUnverified();
    }
    return res;
  }

  /** ボディは呼び出し側がもう一度読むので、複製して覗く。 */
  async function isEmailUnverified(res: Response): Promise<boolean> {
    if (res.status !== 403) return false;
    return (await apiErrorFrom(res.clone())).type === "email-unverified";
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

  return {
    /** いまの状態。置き換わるので、分けて取り出さずに毎回 core.state で読む。 */
    get state() {
      return state;
    },
    setState,
    signOutLocally,
    markEmailUnverified,
    acceptTokens,
    authRequest,
    publicRequest,
    refresh,
    request,
    /** 手元の Access Token を捨てる（refresh で取り直させる）。 */
    dropAccessToken() {
      accessToken = undefined;
    },

    actions: {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): SessionState {
      return state;
    },

    /**
     * 起動時に 1 回だけ、Cookie の Refresh Token からログイン状態を戻す。何度呼んでも同じ Promise を返す。
     * ログインのように認証の要らない画面では呼ばない（ルートのレイアウトではなく、認証を使うページが呼ぶ）。
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
    },
  };
}

export type SessionCore = ReturnType<typeof createSessionCore>;
