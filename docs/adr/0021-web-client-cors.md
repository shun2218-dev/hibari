# 0021. Web クライアントからの API の呼び方（CORS）

- 状態: 採用
- 日付: 2026-09-16

## 背景

Phase 6-2 で、Next.js のクライアントから API を呼び始める。ローカルでは Web が `http://localhost:3000`（`make web`）、API が `http://localhost:8080`（Caddy）で、オリジンが違う。

- Go のサーバーには CORS の設定がなかった。`Authorization` や `Content-Type: application/json` を付けたリクエストはプリフライトが必要なので、ブラウザから 1 本も呼べない（WebSocket は `OriginPatterns` で許可済み。ADR 0015）。
- Refresh Token の Cookie は `SameSite=Strict; Path=/api/v1/auth`（ADR 0010）。
- CLAUDE.md は、Next.js の Route Handler に置いてよいのは「refresh Cookie の薄いプロキシ」だけとしている。

## 決定

- **ブラウザから Go の API を直接呼ぶ。** Next.js の Route Handler や rewrites を経由させない。
- `internal/httpx` に CORS のミドルウェア（`withCORS`）を足す。
  - 許可するオリジンは `APP_BASE_URL` のオリジンだけ（WebSocket の `OriginPatterns` と同じ値から作る）。完全一致で比べる（大文字小文字は区別しない）。
  - 許可したオリジンには `Access-Control-Allow-Origin: <そのオリジン>` と `Access-Control-Allow-Credentials: true` を返す。
  - プリフライトには `Allow-Methods: GET, POST, PATCH, DELETE`、`Allow-Headers: Authorization, Content-Type, X-Hibari-Client`、`Max-Age: 7200` を返す。ServeMux に OPTIONS は登録しないので、ミドルウェアが 204 で終える。
  - `Expose-Headers: X-Request-Id, Retry-After`。
  - Origin を持つリクエストには、許可の有無にかかわらず `Vary: Origin` を付ける。
  - 許可していないオリジンにはヘッダを付けないだけで、処理は拒否しない。
- **Web と API は同じサイト（登録可能なドメインが同じ）に置く。** 例: `app.hibari.example` と `api.hibari.example`。ローカルは両方 `localhost` なので満たす。

## 理由

- **直接呼ぶ理由**
  - REST と WebSocket が同じ経路になる。Next.js の rewrites は WebSocket のアップグレードを通さないので、プロキシにすると WS だけ別経路になる。
  - レート制限に使うクライアント IP（ADR 0017）がそのまま取れる。Next.js を通すと接続元がすべて Next.js のサーバーになり、Next.js を `TRUSTED_PROXIES` に入れる必要が出る。
  - Refresh Token が Next.js のメモリとログを通らない（ADR 0010 で退けた案と同じ理由）。
- **同じサイトに置く理由**: Cookie は `SameSite=Strict` なので、サイトが違うと refresh のリクエストに載らない。ポートやサブドメインが違うだけなら同じサイトなので載る。`SameSite` を `None` に緩めると CSRF への備えが 1 つ減る。
- **完全一致にする理由**: `Allow-Credentials` を付けるので `*` は使えない。前方一致や正規表現は `localhost:3000.evil.test` のような取り違えを生む。
- **拒否しない理由**: CORS はブラウザが「レスポンスを JS に渡すか」を決める仕組みで、サーバー側の防御ではない。CSRF は、プリフライトが必要なヘッダ（`X-Hibari-Client`）と `Content-Type` の強制で防いでいる（ADR 0010）。許可していないオリジンのプリフライトにヘッダを付けなければ、本体のリクエストは送られない。
- **`Retry-After` を公開する理由**: レート制限（429）のあと、クライアントが再試行までの時間を読むため。CORS の既定では JS から読めない。

## 検討した代替案

- **Next.js の rewrites で `/api/*` を同じオリジンにする**: CORS も同じサイトの制約も要らないが、WebSocket が通らず、クライアント IP が失われ、すべての API が Next.js のサーバーを通る。
- **auth だけ Route Handler の薄いプロキシにする**（CLAUDE.md が許している例外）: Web と API を別のサイトに置けるが、ログイン・登録のレート制限のために Next.js を `TRUSTED_PROXIES` に入れる必要があり、Refresh Token が Next.js を通る。本番の置き場所（Phase 7 以降）が別のサイトに決まったら、この案を検討し直す。
- **許可するオリジンを `WEB_ORIGINS` として別の環境変数にする**: 複数のオリジン（プレビュー環境など）を許せるが、いまは 1 つで足り、WebSocket の Origin と別々に設定がずれる。必要になったら足す。

## 結果（トレードオフ）

- Web と API を別のサイト（例: Vercel の `*.vercel.app` と Fly の `*.fly.dev`）に置くと refresh が動かない。本番のドメインを決めるとき（Phase 7 以降）の制約になる（`docs/deploy.md`）。
- プレビュー環境のように Web のオリジンが複数になると、今の設定では許可できない。
- CLAUDE.md の「refresh Cookie の薄いプロキシ」の例外は、いまは使っていない。
