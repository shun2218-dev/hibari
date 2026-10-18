# 環境ごとの設定

環境によって値を変える設定の一覧。本番のデプロイ手順そのもの（Phase 7 以降）はまだない。

## TRUSTED_PROXIES（ADR 0017）

`X-Forwarded-For` を書き込むと信用してよい、前段のプロキシのアドレス（CIDR をカンマで区切る）。
**空なら `X-Forwarded-For` を一切読まない**。1 つのアドレスも `/32` や `/128` で書く。

| 環境 | 前段 | 値 |
|---|---|---|
| ローカル（compose） | Caddy | `172.31.250.10/32`（Caddy のコンテナのアドレス。`compose.yaml` で固定する） |
| テスト（`go test`） | なし | 空（XFF を使うテストだけがループバックを信頼する） |
| 本番（Fly.io） | Fly のプロキシ | `172.16.0.0/12,fdaa::/16,<アプリの IPv4>/32,<アプリの IPv6>/128` |

### Fly.io の値について

- Fly のプロキシはアプリに `172.16.0.0/12` / `fdaa::/16` のアドレスから接続してくる。
- `X-Forwarded-For` の**右端にはアプリに割り当てた IP**（共有 IPv4 または専用のアドレス）が入る（[Fly Docs: Request headers](https://fly.io/docs/networking/request-headers/)）。右端から信頼するアドレスを飛ばすので、アプリの IP も信頼するアドレスに含める。値は `fly ips list` で確かめる。
- 最初にデプロイしたら、アクセスログの `client_ip` が自分の IP になっていることを確かめる。プロキシの内部アドレスやアプリの IP になっていたら、`TRUSTED_PROXIES` が足りない。
- Fly の前に CDN などのプロキシを足したら、その CDN のアドレスの範囲も加える。
- `172.16.0.0/12` / `fdaa::/16` を信頼すると、同じ Fly の組織の private network にあるほかのアプリも `X-Forwarded-For` を書けてしまう。同じ組織に信頼できないアプリを置かない。

## APP_BASE_URL（ADR 0015 / 0021）

Web クライアントの URL。メールのリンクの起点、WebSocket で許可する Origin、CORS で許可するオリジンに使う。
Next.js も `og:image` などの絶対 URL の起点（`metadataBase`）に使う（ADR 0063 決定 7）。静的なページはビルドのときに決まるので、Next.js には**ビルドの環境**に置く。

| 環境 | 値 |
|---|---|
| ローカル（compose） | `http://localhost:3000`（`make web`） |
| 本番 | `https://app.hibari-chat.com`（置き場所は ADR 0046。ドメインは下の「ドメインと DNS」） |

- **Web と API は同じサイト（登録可能なドメインが同じ）に置く**（`app.hibari-chat.com` と `api.hibari-chat.com`）。Refresh Token の Cookie は `SameSite=Strict` なので、サイトが違うと refresh に載らない。
- `*.vercel.app` や `*.fly.dev` はそれぞれがサイトの単位（Public Suffix List に載っている）なので、別のアプリどうしは同じサイトにならない。独自ドメインを使う。

## SITE_BASE_URL（ADR 0063）

LP（紹介のページ）の URL。LP は Next.js のアプリ（`app.` と同じもの）で描き、`web/proxy.ts` がリクエストの Host をこの値のホストと比べて LP に振り分ける。
LP の `metadataBase`（canonical）、`robots.txt` の `Sitemap:`、`sitemap.xml` の URL にも使う。`APP_BASE_URL` と同じく、Next.js の**ビルドの環境**と実行の環境の両方に置く（proxy.ts は実行のときに読む）。

| 環境 | 値 |
|---|---|
| ローカル | `http://lp.localhost:3000`（既定の値。`make web` のあとに開く。`*.localhost` はループバックに解決される） |
| 本番 | `https://hibari-chat.com`（apex。`www` は作らない） |

- apex で返すのは LP（`/`）と `robots.txt`・`sitemap.xml`・ファビコンと OGP 画像だけ。それ以外の URL は 404 にする（apex でアプリの画面を開かせない）。
- `app.` からは LP の中身（`/lp`）を開けない（404）。同じページが 2 つの URL で読めないようにするため。
- 検索エンジンに載せるのは apex だけ。`app.` には proxy.ts が `X-Robots-Tag: noindex, nofollow` を付ける（ADR 0063 決定 5）。

## メール（ADR 0053）

確認メールとパスワードの再設定のメールを送る。業者の SDK は使わず SMTP で送るので、業者を替えるときは下の値だけを変える。

| 環境 | `MAIL_TRANSPORT` | 送り先 |
|---|---|---|
| ローカル（compose） | `log` | 送らない。リンクを server のログに出す |
| 本番 | `smtp` | Resend（`smtp.resend.com`） |

`MAIL_TRANSPORT` には既定の値がない。設定を忘れると起動しない（黙ってログに出すだけになるのを防ぐ）。
`smtp` のときは次もすべて要る。

| 変数 | 本番（Resend）の値 |
|---|---|
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465`（暗黙の TLS）。`587` にすると STARTTLS で送る |
| `SMTP_USERNAME` | `resend` |
| `SMTP_PASSWORD_FILE` | Resend の API キーを書いたファイルのパス（下の「API キーの渡し方」） |
| `MAIL_FROM` | `hibari <noreply@mail.hibari-chat.com>` |

- **TLS はポート番号で決める。** `465` と `2465` は接続した直後から TLS、それ以外は STARTTLS。STARTTLS を広告しないサーバーには送らない。
- Resend の接続先とポートは [Resend Docs: Send emails with SMTP](https://resend.com/docs/send-with-smtp) で確かめた（2026-09-21）。

### Resend の準備

2026-09-21 に行った手順。作り直すときも同じ。

1. Resend の **Domains → Add Domain** で、**送信用のサブドメイン** `mail.hibari-chat.com` を追加する。ルートのドメインから送らないのは、送信の評判を切り分けるため（Resend も推奨している）。
   - Region は **Tokyo（`ap-northeast-1`）**。Custom Return-Path は既定の `send` のまま。
   - **Tracking Subdomain は空のまま**にし、click tracking と open tracking を使わない（下の「トラッキングを使わない」）。
2. DNS Records は **Auto configure**（Cloudflare にサインインして、そのときだけの許可で Resend がレコードを足す）で入れた。足されたのは次の 3 つで、どれも DNS only。
   値は Resend がドメインごとに出すので、作り直すときは Resend の画面の値をそのまま使う。

   | 種類 | 名前 | 内容 | 用途 |
   |---|---|---|---|
   | CNAME | `send.mail` | `send.forge.rmta.net` | Return-Path（バウンスの受け口と SPF）。中身は Resend 側で管理される |
   | CNAME | `rsend.mail` | `rsend.forge.rmta.net` | Resend が管理する（用途は画面に出ない） |
   | TXT | `resend._domainkey.mail` | `p=…`（公開鍵） | DKIM |

   以前の Resend の案内（MX と `include:amazonses.com` の TXT を自分で置く形）とは違い、CNAME で Resend に任せる形になっていた。
3. **DMARC** を足す。`_dmarc.hibari-chat.com` の TXT に `v=DMARC1; p=none; rua=mailto:<受け取るアドレス>`。
   Cloudflare の **Email → DMARC Management** を有効にすると、レコードとレポートの受け取り先を Cloudflare が用意する。
   `_dmarc` の TXT は 1 つだけにする（2 つあると DMARC が無効になる）。`mail.` にも同じ宣言が効く。
   レポートで SPF と DKIM が通っていることを確かめてから `p=quarantine`、`p=reject` と上げる。
4. Resend の画面でドメインが Verified になったら、**送信だけ**の権限（Sending access）で、`mail.hibari-chat.com` に絞った API キーを作る。

#### トラッキングを使わない

Resend の click tracking はメールの中のリンクを転送用の URL に書き換え、open tracking は見えない画像を入れる。どちらも使わない。

- hibari のメールのリンクにはワンタイムトークン（`/verify-email?token=…`、`/reset-password?token=…`）が入る。業者の転送を通すと、トークン入りの URL が外に出る（CLAUDE.md。`/verify-email` を `no-referrer` にしているのと同じ理由）。
- 送るのは確認と再設定の 2 種類だけで、開封やクリックを数える理由がない。
- トラッキングが働くのは「ドメインの設定で有効」かつ「トラッキング用のサブドメインが Verified」のときだけ（[Resend Docs: Tracking](https://resend.com/docs/dashboard/domains/tracking)）。サブドメインを作らなければ働かない。
  画面のチェックを外すときは、ドメインの **Configuration** のタブで行う（「New tracking subdomain」の画面はサブドメインを作る画面で、サブドメインが必須になる）。

### API キーの渡し方（Fly.io）

API キーは環境変数ではなくファイルで渡す（`JWT_PRIVATE_KEY_FILE` と同じ）。Fly では、シークレットをファイルとしてマシンに置ける。

```toml
# fly.toml
[[files]]
guest_path = "/run/secrets/smtp_password"
secret_name = "SMTP_PASSWORD"
```

```bash
fly secrets set SMTP_PASSWORD="$(printf '%s' 're_xxxxxxxx' | base64)"
```

`secret_name` で置くシークレットは **base64 で渡す**（Fly が戻してファイルに書く。[Fly Docs: files](https://fly.io/docs/reference/configuration/#the-files-section)）。
末尾の改行は server が読むときに取り除く。

### 届いたことの確かめ方

- 登録し、確認メールが届くこと、迷惑メールに入らないこと、リンクが書き換えられていないことを確かめる。
- ヘッダの `spf=pass` / `dkim=pass` / `dmarc=pass` を見る。Gmail なら、PC のブラウザでメールを開き「︙ → メッセージのソースを表示」の上の表に出る。
- Resend の **Emails** の画面に、送ったメールごとの状態（Delivered / Bounced）が出る。届かないときは、まずここで業者から相手のサーバーまで届いたかを切り分ける。
- 2026-09-22 に、ローカルから下の手順で Gmail に送り、受信トレイに届き、SPF・DKIM・DMARC がすべて PASS、リンクもそのままだった（ADR 0053 の追記）。

#### ローカルから本物のメールを送る

本番にデプロイする前でも、compose の server を SMTP の設定にして、Resend 経由で送れる。

1. Resend の API キーを `keys/resend_api_key` に置く（`keys/` は `.gitignore` 済みで、`/src/keys` に bind mount されている）。
   ```bash
   pbpaste > keys/resend_api_key && chmod 600 keys/resend_api_key
   ```
2. `compose.smtp.yaml` を重ねて server を起動し直す。`MAIL_TRANSPORT=smtp` と `AUTH_REQUIRE_VERIFIED_EMAIL=true` になる。
   ```bash
   docker compose -f compose.yaml -f compose.smtp.yaml up -d server
   ```
3. `http://localhost:3000/signup` で自分のアドレスで登録する。リンクは `http://localhost:3000/…` なので、開くのは PC のブラウザから。
4. 終わったら戻す: `docker compose up -d server`
- **送れなかったメールは失う**（数回だけ送り直す。ADR 0053 決定 6）。server のログの `mail queue: gave up` と `mail queue: dropped on shutdown` を見る。ログには宛先も本文も出さず、種類（`kind`）だけを出す。

### email の検証（`AUTH_REQUIRE_VERIFIED_EMAIL`）

email を検証するまで、chat の API と WebSocket は 403（`email-unverified`）になる（ADR 0053 決定 1）。

| 環境 | `AUTH_REQUIRE_VERIFIED_EMAIL` |
|---|---|
| ローカル（compose） | `false`（検証なしで使える。試すときは `AUTH_REQUIRE_VERIFIED_EMAIL=true make up` にして、ログに出る確認のリンクを開く） |
| 本番 | 設定しない（既定の `true`） |

`MAIL_TRANSPORT=smtp` のときに `false` にすると起動しない。メールが届く環境で検証を外す理由はないので、本番で誤って外れることがない。

## ハドル（Cloudflare Realtime。ADR 0066）

ハドルの音声は Cloudflare Realtime の SFU を通し、つながらないときは Cloudflare の TURN で中継する（ADR 0066 決定 1・14）。
**Cloudflare にはローカルで動く版がないので、開発でも本物の Cloudflare を使う。** 公式の推奨どおり、開発用と本番用でアプリとキーを分ける。

| 環境変数 | 値 |
|---|---|
| `CLOUDFLARE_REALTIME_APP_ID` | SFU のアプリの App ID（秘密ではない） |
| `CLOUDFLARE_REALTIME_APP_SECRET_FILE` | SFU のアプリの App Secret を書いたファイルのパス |
| `CLOUDFLARE_TURN_KEY_ID` | TURN のキーの ID（秘密ではない） |
| `CLOUDFLARE_TURN_KEY_API_TOKEN_FILE` | TURN のキーの API Token を書いたファイルのパス |

- **4 つとも設定しなければ、ハドルだけが無効になって起動する**（API は 503 `huddles-unavailable`、Web はボタンを出さない）。Cloudflare のアカウントがなくても、ほかの開発はできる。
- 一部だけ設定すると起動しない（書き忘れて、ハドルが黙って消えるのを防ぐ）。
- 使いすぎのときに止めたければ、4 つとも外して再起動する。

### Cloudflare の準備

開発用（`hibari-dev`）と本番用（`hibari-prod`）で、同じ手順を 2 回行う。

1. ダッシュボードで「Realtime」→「Serverless SFU」→ アプリを作る。**App ID** と **App Secret** を控える（App Secret はすぐに保存する）。
2. 「Realtime」→「TURN Server」→ キーを作る。**Key ID** と **API Token** を控える。
3. 「Manage Account」→「Billing」→「Billable Usage」→「Create budget alert」で、少額（1 ドルなど）の予算の通知を作る。
   SFU と TURN は合わせて月 1,000 GB まで無料で、超えると 1 GB 0.05 ドル。**Cloudflare には使用量で止める仕組みがない**ので、超えたことにメールで気づけるようにする（ADR 0066 の結果）。

### ローカル（compose）

秘密は `keys/` にファイルで置く（`.gitignore` 済みで、`/src/keys` に bind mount されている）。

```bash
pbpaste > keys/cloudflare_realtime_app_secret
```

```bash
pbpaste > keys/cloudflare_turn_api_token
```

```bash
chmod 600 keys/cloudflare_*
```

`.env`（compose が server に渡す。開発用で、コミットしない）に 4 つを書く。ID は自分の開発用のアプリのもの。

```
CLOUDFLARE_REALTIME_APP_ID=<App ID>
CLOUDFLARE_REALTIME_APP_SECRET_FILE=/src/keys/cloudflare_realtime_app_secret
CLOUDFLARE_TURN_KEY_ID=<Key ID>
CLOUDFLARE_TURN_KEY_API_TOKEN_FILE=/src/keys/cloudflare_turn_api_token
```

キーが使えるかは、ホストから確かめられる。SFU は `{"sessionId":"..."}`、TURN は `iceServers` が返れば使える。

```bash
curl -s -X POST "https://rtc.live.cloudflare.com/v1/apps/<App ID>/sessions/new" -H "Authorization: Bearer $(cat keys/cloudflare_realtime_app_secret)"
```

```bash
curl -s -X POST "https://rtc.live.cloudflare.com/v1/turn/keys/<Key ID>/credentials/generate-ice-servers" -H "Authorization: Bearer $(cat keys/cloudflare_turn_api_token)" -H "Content-Type: application/json" -d '{"ttl":60}'
```

### TURN を通る経路を確かめる（開発）

同じ Mac の 2 つのブラウザでは、どちらも Cloudflare の SFU に直接つながるので、TURN の中継は使われない。
違うネットワークを用意しなくても中継の経路を確かめられるように、ブラウザに直接の経路を捨てさせる切り替えがある。

1. `.env` に `HUDDLE_ICE_TRANSPORT_POLICY=relay` を足して、server を作り直す（`docker compose up -d server`）。
   起動のログの `huddles: enabled` に `relay_only=true` が出る。
2. 2 つのブラウザでハドルに入り、互いの声が聞こえることを確かめる。
3. Chrome なら `chrome://webrtc-internals` を開き、ハドルの `RTCPeerConnection` の `candidate-pair` で、選ばれたもの（`nominated`・`state: succeeded`）の local 側の `candidateType` が `relay` になっていることを見る。
4. 終わったら `HUDDLE_ICE_TRANSPORT_POLICY` を消して server を作り直す。中継は SFU と同じ無料の枠を使うので、つけっぱなしにしない。

値は `all`（既定）と `relay` だけ（`RTCConfiguration` の `iceTransportPolicy` と同じ名前と値）。ほかの値だと起動しない。
ハドルが無効（`CLOUDFLARE_*` がない）のときは読まない。**本番では設定しない。**

### 本番（Fly.io）

秘密はメールの API キーと同じく、Fly のシークレットをファイルとして置く（上の「API キーの渡し方」）。

```toml
# fly.toml
[env]
CLOUDFLARE_REALTIME_APP_ID = "<本番の App ID>"
CLOUDFLARE_REALTIME_APP_SECRET_FILE = "/run/secrets/cloudflare_realtime_app_secret"
CLOUDFLARE_TURN_KEY_ID = "<本番の Key ID>"
CLOUDFLARE_TURN_KEY_API_TOKEN_FILE = "/run/secrets/cloudflare_turn_api_token"

[[files]]
guest_path = "/run/secrets/cloudflare_realtime_app_secret"
secret_name = "CLOUDFLARE_REALTIME_APP_SECRET"

[[files]]
guest_path = "/run/secrets/cloudflare_turn_api_token"
secret_name = "CLOUDFLARE_TURN_KEY_API_TOKEN"
```

```bash
fly secrets set CLOUDFLARE_REALTIME_APP_SECRET="$(pbpaste | base64)"
```

```bash
fly secrets set CLOUDFLARE_TURN_KEY_API_TOKEN="$(pbpaste | base64)"
```

音声は利用者のブラウザと Cloudflare の間を直接流れ、Fly を通らない（ADR 0066 決定 2）。Fly で UDP を受ける設定（専用の IPv4 など）は要らない。

## 置き場所（ADR 0046）

| 役割 | 本番 | ローカル |
|---|---|---|
| Go サーバー（API / WebSocket） | Fly app（`nrt`）/ `api.hibari-chat.com` | compose の `server`（Caddy の後ろ） |
| Next.js | Fly app（`nrt`）/ `app.hibari-chat.com` と `hibari-chat.com`（LP。上の `SITE_BASE_URL`） | ホストで `make web`（LP は `lp.localhost:3000`） |
| Storybook | Fly app（`nrt`、静的 + `auto_stop_machines`）/ `ui.hibari-chat.com` | ホスト |
| ドキュメントサイト | Fly app（`nrt`、静的 + `auto_stop_machines`）/ `docs.hibari-chat.com`（ADR 0064） | ホストで `make site` |
| Postgres | Fly app + ボリューム（自前） | compose の `postgres` |
| Valkey | Fly app（自前・永続化なし） | compose の `redis` |
| オブジェクトストレージ | Cloudflare R2 | compose の `s3`（RustFS） |

`app` / `api` / `ui` の 3 つのサブドメインを同じ登録可能ドメインに置くのは、Refresh Token の Cookie（`SameSite=Strict`）を載せるため（上の `APP_BASE_URL`）。

## ドメインと DNS（ADR 0046 の追記）

- ドメインは **`hibari-chat.com`**。**Cloudflare Registrar** で取得し、DNS も Cloudflare（Registrar のドメインは Cloudflare のネームサーバーでしか使えない）。
- サブドメインは、Cloudflare の **DNS → Records → Add record** でレコードを足すだけ。Name には `api` のように左側だけを入れる（`.hibari-chat.com` は自動で付く）。

| 名前 | 種類 | 向け先 | 状態 |
|---|---|---|---|
| `app` / `api` / `ui` / `docs` | A と AAAA（または `<アプリ名>.fly.dev` への CNAME） | それぞれの Fly app | Phase 7 のデプロイで足す |
| `@`（apex。LP） | A と AAAA | Next.js の Fly app（`app` と同じ） | Phase 7 のデプロイで足す |
| `send.mail` / `rsend.mail` / `resend._domainkey.mail` | CNAME / CNAME / TXT | Resend | 足した（上の「Resend の準備」） |
| `_dmarc` | TXT | — | 足した（`p=none`） |

### Fly app に向ける手順（`app` / `api` / `ui` / `docs` / apex）

1. `fly certs add api.hibari-chat.com -a <アプリ名>` で証明書を申し込み、出てきた値（A / AAAA か CNAME）を Cloudflare に足す。
   apex（`hibari-chat.com`）は Next.js のアプリに `fly certs add hibari-chat.com` で足し、Name を `@` にして A と AAAA を入れる（apex には CNAME を置かない）。
2. **Proxy status は DNS only（灰色の雲）にする。** Cloudflare のプロキシ（オレンジの雲）を通すと、Fly の証明書の自動発行とぶつかる。
   また、前段が Fly のプロキシである前提（`TRUSTED_PROXIES`。上の節と ADR 0017）が崩れ、クライアントの IP の取り方が変わる。
3. `fly certs check api.hibari-chat.com -a <アプリ名>` で発行されたことを確かめる。

## ドキュメントサイト（ADR 0064）

`site/` を `npm run build` で静的に書き出し（`site/out/`）、Storybook と同じく静的なファイルを配る Fly app に載せる。

- ビルドは `docs/` と `web/app/globals.css`（色のトークン）を読むので、リポジトリのルートで行う（`site/` だけを切り出してビルドしない）。
- 環境変数は要らない。サーバーの処理はなく、検索の索引（`/api/search`）もビルドのときに作る。
- **検索エンジンに載せない。** `robots.txt`（`Disallow: /`）と meta の noindex はビルドの出力に入っている。配る側で足すものはない。
- `docs/` や OpenAPI（`docs/api/openapi.json`）を変えたら、サイトもビルドし直して出す。main へのリリースのたびに出し直す。

## ストレージ（ADR 0008 / 0046）

| 環境 | Endpoint | Region | UsePathStyle |
|---|---|---|---|
| ローカル（compose） | `http://s3:9000`（署名用は `http://localhost:9000`） | `us-east-1` | `true` |
| 本番（R2） | `https://<アカウントID>.r2.cloudflarestorage.com` | `auto` | `false` |

- バケットは 2 つ: **添付ファイル用**と **DB のバックアップ用**。
- **バケットに CORS を設定する。** ブラウザが署名付き URL に直接 PUT / GET する（CLAUDE.md ルール 10）ため。
  許可オリジンは `APP_BASE_URL`、メソッドは `PUT` と `GET`、許可ヘッダは `content-type`。
- コードは環境で分岐しない（`internal/platform/storage` の設定値だけが変わる）。

## Postgres のイメージ（ADR 0061）

**Postgres は自前でビルドしたイメージを使う。** 素の `postgres:16-alpine` に pg_bigm を足したもので、
Dockerfile は `db/postgres/Dockerfile`。日本語の検索に 2-gram の索引が要るため（ADR 0061 決定 1）。

- ローカル（compose）・CI（`.github/workflows/go.yml`）・本番（Fly）が、同じ Dockerfile をビルドして使う。
- pg_bigm の版は Dockerfile の `PG_BIGM_VERSION` で固定する。上げるときは、先にローカルでビルドしてテストを通す。
- **Postgres のメジャーバージョンを上げるときは、このイメージのビルドが通ることを先に確かめる。**
  pg_bigm がその版に対応していないと、ビルドが落ちるか、拡張が読み込めずに起動後の `CREATE EXTENSION` で落ちる。
- 素の `postgres:16-alpine` に向けると、マイグレーション 00019（`CREATE EXTENSION pg_bigm`）で失敗する。

## Postgres のバックアップ（ADR 0046）

自前で持つので、バックアップも自前。

- `pg_dump` を日次で実行し、R2 のバックアップ用バケットに置く。
- Fly のボリュームのスナップショットは保険として使う（保持期間が短いので、これだけに頼らない）。
- **復旧の手順をここに書き、実際に 1 回戻すまで「バックアップがある」と言わない。** 手順は Phase 7 で書く。

## Valkey（ADR 0046）

永続化（RDB / AOF）もボリュームも持たない。中に入るのは presence / typing（TTL）・Pub/Sub・ws-ticket・失効イベントだけで、
落ちても再接続の差分（`after_seq` / `after_change_seq`）で追いつけるため（CLAUDE.md ルール 4、ADR 0016）。
再起動すると presence が一斉に消え、各クライアントの再送で戻るまでオンラインの点が消える。
