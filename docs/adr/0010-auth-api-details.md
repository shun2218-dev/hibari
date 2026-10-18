# 0010. 認証 API の詳細（トークンの形式と受け渡し、ローテーション、エラー形式）

- 状態: 採用
- 日付: 2026-09-13

## 背景

Phase 2 で認証を実装するにあたり、ロードマップと ADR 0007 が決めていない次の点を確定させる必要があった。

- Refresh Token を Cookie とボディのどちらで受け渡すかを、サーバーが何で判定するか（CLAUDE.md ルール 2）
- Access JWT の具体的な形式と、検証で何を拒否するか
- ローテーションで「同じトークンの並行利用」をどう扱うか
- 登録で email の重複をどう返すか（CLAUDE.md の「存在有無を明かさない」は認証の失敗が対象で、登録については決まっていなかった）
- API のエラーの形式（RFC 9457）の具体的な書き方

## 決定

### エンドポイント

| メソッドとパス | 認証 | 成功時 |
|---|---|---|
| `POST /api/v1/auth/register` | なし | 201。ユーザーとトークン（登録と同時にログインする） |
| `POST /api/v1/auth/login` | なし | 200。ユーザーとトークン |
| `POST /api/v1/auth/refresh` | Refresh Token | 200。ローテーションしたトークン |
| `POST /api/v1/auth/logout` | Refresh Token | 204。そのセッションだけを失効させる |
| `GET /api/v1/users/me` | Access Token | 200。自分のユーザー |
| `GET /.well-known/jwks.json` | なし | 200。検証用の公開鍵（JWK Set） |

`me` を `/api/v1/auth/` の下に置かないのは、Refresh Token の Cookie（`Path=/api/v1/auth`）を載せないため。

### Refresh Token の受け渡し

- **`X-Hibari-Client: web` ヘッダがあれば Cookie、なければ JSON ボディ**で受け渡す。分岐は `internal/httpx/tokentransport.go` だけに書き、`internal/auth` は生のトークン文字列だけを扱う。
- Cookie は `hibari_refresh`、`HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=30日`。refresh が失敗したときとログアウトでは消させる。
- Cookie 方式でもボディにトークンは出さない。
- JSON を受け取るエンドポイントは `Content-Type: application/json` 以外を 415 で拒否する。

### Access Token

- EdDSA（Ed25519）。鍵は `JWT_PRIVATE_KEY_FILE` の PKCS#8 PEM から読み、なければ起動時に落ちる。
- ヘッダは `alg=EdDSA`、`typ=at+jwt`（RFC 9068）、`kid`=公開鍵の JWK Thumbprint（RFC 7638）。
- クレームは `sub, sid, jti, iat, exp, iss, aud` の 7 つだけ。
- 検証（`internal/platform/authn`）では、ヘッダの `alg` を信じずに EdDSA に固定し、`typ` と `kid` が一致しなければ拒否する。`sub` と `sid` は ULID でなければ拒否する。
- トークンは `Authorization: Bearer` からだけ読み、クエリ文字列や Cookie からは読まない。

### ローテーションと再利用の検知

- refresh は、トークンの行を `SELECT ... FOR UPDATE` でロックしてから、rotated で失効させて同じ family に新しいトークンを発行する。有効期限はその時点から 30 日に数え直す。
- rotated で失効済みのトークンが使われたら、family 全体を `reuse_detected` で失効させ、`auth:revoked` に sid を publish する。この失効はエラーを返す経路でもコミットする。
- **猶予期間（直前のトークンを数秒だけ受け付けるなど）は設けない。** 同じトークンの並行利用も再利用として扱う。
- logout / reuse_detected などで family ごと失効済みのトークンが使われても、二重に失効・通知しない。

### 登録

- email または handle が使われていれば 409（`email-taken` / `handle-taken`）を返す。**登録では email の存在を明かす。**
- 列挙への対策として、登録にも IP 単位のレート制限を付ける（Phase 2 のレート制限と同時に入れる）。
- ログインとパスワードリセットでは、引き続き存在を明かさない（同じエラー・同じ処理時間）。
- email が未確認でもログインと Phase 3 以降の操作は制限しない。制限が必要になったら、Phase 3a の着手前に決める。

### パスワード

- Argon2id、`m=19 MiB, t=2, p=1`（OWASP の推奨値）。PHC 文字列形式で保存し、検証時のパラメータはハッシュから読む。
- 長さは 8〜128 文字（rune 単位）。文字種の組み合わせは強制しない（NIST SP 800-63B）。
- 存在しないユーザーのログインでも、起動時に作ったダミーのハッシュで 1 回検証してから失敗を返す。

### エラーの形式

- RFC 9457（`application/problem+json`）。`type` は `tag:hibari,2026:problem:<slug>`（RFC 4151 の tag URI）。
- 拡張メンバーとして `request_id` を必ず、入力の検証エラーでは `errors: [{field, reason}]` を付ける。`reason` は `required / too_short / too_long / invalid_format`。
- クライアントは `type` と `reason` で分岐し、`title` を表示に使わない（文言は UI 側で持つ）。
- Access Token の失敗は 401 `unauthenticated` に `WWW-Authenticate: Bearer`（トークンがない）または `Bearer error="invalid_token"`（不正・期限切れ）を付ける（RFC 6750）。

## 理由

- **判定をヘッダにする理由**: ログインの時点ではまだ Cookie がないので、Cookie の有無では判定できない。また、カスタムヘッダ付きのリクエストは CORS のプリフライトなしに他のオリジンから送れないので、Cookie だけで refresh / logout させない CSRF 対策を `SameSite=Strict` と二重にかけられる。
- **Content-Type を強制する理由**: `text/plain` やフォームの POST はプリフライトなしに送れるので、受け付けるとログイン CSRF などの入口になる。
- **`typ` と `alg` を固定する理由**: RFC 8725（JWT BCP）の推奨。`alg: none` や alg confusion を、ライブラリの設定に頼らずコードで明示的に拒否する。
- **`kid` を Thumbprint にする理由**: 鍵から決まる値なので、複数台のサーバーが設定なしで同じ `kid` を使え、鍵を替えれば必ず変わる。
- **猶予期間を設けない理由**: ロードマップの DoD（2 回使うと family 全体が失効する）をそのまま満たし、判定を「rotated で失効済みかどうか」の 1 つに保つ。猶予期間を入れると、その間に盗まれたトークンを使われても検知できない。
- **登録で email を明かす理由**: 明かさない方式にすると、登録後に即ログインできず、確認メールの再送を未ログインで受け付ける必要が出るなどフローが複雑になる。handle の重複はどちらの方式でも明かすことになる。サービスの規模に対して、IP 単位のレート制限で列挙のコストを上げれば十分と判断した（オーナーの判断）。
- **problem の `type` を tag URI にする理由**: RFC 9457 の `type` は URI だが、解決できるドキュメントの URL を用意していない。相対 URI は RFC 9457 が非推奨としており、tag URI なら登録なしで一意な識別子を作れる。

## 検討した代替案

- **Cookie とボディで別のエンドポイントにする（`/auth/web/refresh` など）**: 分岐は URL に現れて分かりやすいが、同じ処理のエンドポイントが倍になる。
- **Go サーバーは常にボディで返し、Next.js の Route Handler が Cookie に詰め替える**: Go 側は単純になるが、Refresh Token が Next.js のサーバーのメモリとログを通過し、「薄いプロキシ」の範囲を超える。
- **ローテーションに数秒の猶予期間を設ける**: 複数タブの同時 refresh で誤検知しなくなるが、上記の理由で採用しない。代わりにクライアントで対処する（結果を参照）。
- **登録で email の存在を明かさない（常に 202 を返し、既存のアドレスには通知メールを送る）**: 列挙を防げるが、フローの複雑さに見合わない（上記）。
- **RS256**: 対応するクライアントライブラリは多いが、鍵と署名が大きく、鍵長の選択を誤る余地がある。検証するのは自分のサーバーだけなので EdDSA で困らない。

## 結果（トレードオフ）

- **Web クライアントは、タブをまたいで refresh を 1 本に絞る必要がある**（Phase 6）。同じ Cookie を持つ複数のタブが同時に refresh すると、2 本目が再利用として検知され、全タブがログアウトする。Web Locks API などでタブ間の単一フライトにする。
- Cookie は `Path=/api/v1/auth` なので、Next.js が refresh Cookie をプロキシするときも同じパスで受ける必要がある（Phase 6）。
- 監査用の IP は接続元のアドレス（`RemoteAddr`）だけを使う。Phase 5 で Caddy を前に置いたら、信頼するプロキシを設定で受け取り、`X-Forwarded-For` を読むようにする。
- Argon2id の 1 回の検証で 19 MiB を使うので、同時に大量のログインが来るとメモリを圧迫する。レート制限（Phase 2）で緩和する。
- パスワードのパラメータを上げても、既存のハッシュは古いパラメータのまま残る。ログイン時の再ハッシュは必要になったら入れる。
- `me` で退会済みのユーザーが見つからない場合は、404 ではなく 401 を返す（トークンの主体が存在しない）。

## 追記

### 2026-09-13: メールの確認、パスワードリセット、回数制限

**エンドポイント**

| メソッドとパス | 認証 | 成功時 |
|---|---|---|
| `POST /api/v1/auth/verify-email/request` | Access Token | 202。確認メールを送り直す（確認済みなら送らない） |
| `POST /api/v1/auth/verify-email/confirm` | なし（`token`） | 204 |
| `POST /api/v1/auth/password-reset/request` | なし（`email`） | 202。アカウントの有無に関係なく同じ |
| `POST /api/v1/auth/password-reset/confirm` | なし（`token`, `password`） | 204。そのユーザーの全セッションを失効させる |

登録すると確認メールも送る（送れなくても登録は成功させる）。

**ワンタイムトークン**
- Refresh Token と同じ 32 バイトの乱数で、SHA-256 だけを `one_time_tokens` に保存する。
- 有効期限は、確認が 24 時間、再設定が **1 時間**（`docs/ui` の文言に合わせた）。
- 新しいトークンを発行するときに、同じ用途の未使用のトークンを削除する（有効なリンクは常に最新の 1 つ）。
- 消費は `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now RETURNING user_id` の 1 文にして、同時に開いても成功を 1 回に限る。
- 存在しない・期限切れ・使用済みは区別せずに 400 `invalid-one-time-token` を返す。
- リンクは `APP_BASE_URL` の `/verify-email?token=...` と `/reset-password?token=...`。短命・使い捨てなので URL に載せてよいトークンとして扱う。受け取るページ（Phase 6）は `Referrer-Policy` で Referer に載せないようにする。
- パスワードの再設定では、制約を満たさないパスワードならトークンを消費せずに 422 を返す（同じリンクで入力し直せる）。
- 再設定が完了したら、全 family を `password_reset` で失効させて `{"user_id", "all": true}` を publish する。リンクがその email に届いたので、email も確認済みにする。
- 開発用の Mailer（`auth.LogMailer`）はリンクを server のログに出す。本番の Mailer は送信を待たずにキューに積んで戻る実装にする（同期で送ると、再設定の要求の応答時間の差でアカウントの有無が分かる）。

**回数制限**（`internal/platform/ratelimit`、Redis の固定ウィンドウ）

| 対象 | 単位 | 上限 |
|---|---|---|
| ログイン | IP | 50 回 / 15 分 |
| ログイン | アカウント（email） | 10 回 / 15 分 |
| 登録 | IP | 10 回 / 1 時間 |
| 再設定メールの要求 | IP | 10 回 / 1 時間 |
| 再設定メールの要求 | アカウント（email） | 3 回 / 1 時間 |
| 確認メールの再送 | ユーザー | 5 回 / 1 時間 |

- 超えたら 429 `rate-limited` と `Retry-After`（秒）を返す。どのルールで止まったかは区別しない。
- 成功した試行も数える。アカウント単位のキーは email を小文字にしたもので、アカウントが存在しない email も同じように数える（制限のかかり方でアカウントの有無が分からないように）。
- ウィンドウは Redis の TTL ではなく Clock の時刻から決める（キーにウィンドウの番号を入れる）。キーの email や IP はハッシュにする。
- **Redis に問い合わせられないときは制限せずに通す（fail-open）。** 回数制限は多層防御の 1 つで、Argon2id によって総当たりはもともと遅い。Redis の障害をログインの障害にしない方を選んだ。
- 固定ウィンドウは境界の前後で最大 2 倍まで通るが、目的は総当たりや大量送信のコストを上げることなので許容する。
- アカウント単位の制限は、他人がわざと失敗してそのアカウントのログインを 15 分止める（ロックアウト）ことにも使える。上限を IP 単位より厳しくしすぎないことで緩和し、問題になったら CAPTCHA などを検討する。
