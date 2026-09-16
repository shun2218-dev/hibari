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
| 本番 | 未定（Phase 7 以降） |

- **Web と API は同じサイト（登録可能なドメインが同じ）に置く**（例: `app.hibari.example` と `api.hibari.example`）。Refresh Token の Cookie は `SameSite=Strict` なので、サイトが違うと refresh に載らない。
- `*.vercel.app` や `*.fly.dev` はそれぞれがサイトの単位（Public Suffix List に載っている）なので、別のアプリどうしは同じサイトにならない。独自ドメインを使う。
