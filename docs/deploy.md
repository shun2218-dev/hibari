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

| 環境 | 値 |
|---|---|
| ローカル（compose） | `http://localhost:3000`（`make web`） |
| 本番 | `https://app.hibari-chat.com`（置き場所は ADR 0046。ドメインは下の「ドメインと DNS」） |

- **Web と API は同じサイト（登録可能なドメインが同じ）に置く**（`app.hibari-chat.com` と `api.hibari-chat.com`）。Refresh Token の Cookie は `SameSite=Strict` なので、サイトが違うと refresh に載らない。
- `*.vercel.app` や `*.fly.dev` はそれぞれがサイトの単位（Public Suffix List に載っている）なので、別のアプリどうしは同じサイトにならない。独自ドメインを使う。

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

## 置き場所（ADR 0046）

| 役割 | 本番 | ローカル |
|---|---|---|
| Go サーバー（API / WebSocket） | Fly app（`nrt`）/ `api.hibari-chat.com` | compose の `server`（Caddy の後ろ） |
| Next.js | Fly app（`nrt`）/ `app.hibari-chat.com` | ホストで `make web` |
| Storybook | Fly app（`nrt`、静的 + `auto_stop_machines`）/ `ui.hibari-chat.com` | ホスト |
| Postgres | Fly app + ボリューム（自前） | compose の `postgres` |
| Valkey | Fly app（自前・永続化なし） | compose の `redis` |
| オブジェクトストレージ | Cloudflare R2 | compose の `minio` |

3 つのサブドメインを同じ登録可能ドメインに置くのは、Refresh Token の Cookie（`SameSite=Strict`）を載せるため（上の `APP_BASE_URL`）。

## ドメインと DNS（ADR 0046 の追記）

- ドメインは **`hibari-chat.com`**。**Cloudflare Registrar** で取得し、DNS も Cloudflare（Registrar のドメインは Cloudflare のネームサーバーでしか使えない）。
- サブドメインは、Cloudflare の **DNS → Records → Add record** でレコードを足すだけ。Name には `api` のように左側だけを入れる（`.hibari-chat.com` は自動で付く）。

| 名前 | 種類 | 向け先 | 状態 |
|---|---|---|---|
| `app` / `api` / `ui` | A と AAAA（または `<アプリ名>.fly.dev` への CNAME） | それぞれの Fly app | Phase 7 のデプロイで足す |
| `send.mail` / `rsend.mail` / `resend._domainkey.mail` | CNAME / CNAME / TXT | Resend | 足した（上の「Resend の準備」） |
| `_dmarc` | TXT | — | 足した（`p=none`） |

### Fly app に向ける手順（`app` / `api` / `ui`）

1. `fly certs add api.hibari-chat.com -a <アプリ名>` で証明書を申し込み、出てきた値（A / AAAA か CNAME）を Cloudflare に足す。
2. **Proxy status は DNS only（灰色の雲）にする。** Cloudflare のプロキシ（オレンジの雲）を通すと、Fly の証明書の自動発行とぶつかる。
   また、前段が Fly のプロキシである前提（`TRUSTED_PROXIES`。上の節と ADR 0017）が崩れ、クライアントの IP の取り方が変わる。
3. `fly certs check api.hibari-chat.com -a <アプリ名>` で発行されたことを確かめる。

## ストレージ（ADR 0008 / 0046）

| 環境 | Endpoint | Region | UsePathStyle |
|---|---|---|---|
| ローカル（compose） | `http://minio:9000`（署名用は `http://localhost:9000`） | `us-east-1` | `true` |
| 本番（R2） | `https://<アカウントID>.r2.cloudflarestorage.com` | `auto` | `false` |

- バケットは 2 つ: **添付ファイル用**と **DB のバックアップ用**。
- **バケットに CORS を設定する。** ブラウザが署名付き URL に直接 PUT / GET する（CLAUDE.md ルール 10）ため。
  許可オリジンは `APP_BASE_URL`、メソッドは `PUT` と `GET`、許可ヘッダは `content-type`。
- コードは環境で分岐しない（`internal/platform/storage` の設定値だけが変わる）。

## Postgres のバックアップ（ADR 0046）

自前で持つので、バックアップも自前。

- `pg_dump` を日次で実行し、R2 のバックアップ用バケットに置く。
- Fly のボリュームのスナップショットは保険として使う（保持期間が短いので、これだけに頼らない）。
- **復旧の手順をここに書き、実際に 1 回戻すまで「バックアップがある」と言わない。** 手順は Phase 7 で書く。

## Valkey（ADR 0046）

永続化（RDB / AOF）もボリュームも持たない。中に入るのは presence / typing（TTL）・Pub/Sub・ws-ticket・失効イベントだけで、
落ちても再接続の差分（`after_seq` / `after_change_seq`）で追いつけるため（CLAUDE.md ルール 4、ADR 0016）。
再起動すると presence が一斉に消え、各クライアントの再送で戻るまでオンラインの点が消える。
