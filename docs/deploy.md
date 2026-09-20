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
| 本番 | `https://app.<独自ドメイン>`（ドメインの取得は Phase 7。置き場所は ADR 0046） |

- **Web と API は同じサイト（登録可能なドメインが同じ）に置く**（例: `app.hibari.example` と `api.hibari.example`）。Refresh Token の Cookie は `SameSite=Strict` なので、サイトが違うと refresh に載らない。
- `*.vercel.app` や `*.fly.dev` はそれぞれがサイトの単位（Public Suffix List に載っている）なので、別のアプリどうしは同じサイトにならない。独自ドメインを使う。

## 置き場所（ADR 0046）

| 役割 | 本番 | ローカル |
|---|---|---|
| Go サーバー（API / WebSocket） | Fly app（`nrt`）/ `api.<ドメイン>` | compose の `server`（Caddy の後ろ） |
| Next.js | Fly app（`nrt`）/ `app.<ドメイン>` | ホストで `make web` |
| Storybook | Fly app（`nrt`、静的 + `auto_stop_machines`）/ `ui.<ドメイン>` | ホスト |
| Postgres | Fly app + ボリューム（自前） | compose の `postgres` |
| Valkey | Fly app（自前・永続化なし） | compose の `redis` |
| オブジェクトストレージ | Cloudflare R2 | compose の `minio` |

3 つのサブドメインを同じ登録可能ドメインに置くのは、Refresh Token の Cookie（`SameSite=Strict`）を載せるため（上の `APP_BASE_URL`）。

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
