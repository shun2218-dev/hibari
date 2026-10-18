# 0046. 本番のデプロイ構成（Fly.io の 1 リージョンに寄せ、ストレージは R2。Postgres と Valkey は自前で持つ）

- 状態: 採用
- 日付: 2026-09-20

## 背景

ロードマップ Phase 7 の「本番のデプロイと、本番ストレージの最終決定（ADR 0008 の見直し）」。
デプロイの**手順**はまだ書かないが、**置き場所**を決めないと次が埋まらない。

- `docs/deploy.md` の `APP_BASE_URL`（本番: 未定）。メールのリンク・CORS・WebSocket の Origin 検査がこれを使う
- ストレージの独自ドメインと CORS の設定
- Storybook（別 ADR で導入する UI のドキュメント）の置き場所

判断の前提になった、すでに決まっていること:

- **Refresh Token の Cookie は `SameSite=Strict`**（ADR 0010 / 0024）。Web と API は**同じ登録可能ドメイン**に置かないと refresh に載らない。
  `*.fly.dev` / `*.vercel.app` / `*.pages.dev` は Public Suffix List 上それぞれが「サイト」なので、**独自ドメインが要る**（`docs/deploy.md`）
- **ブラウザは Go の API を直接叩く**（ADR 0024 の `credentials: "include"`）。Next に Route Handler は 1 つもなく、SSR・ISR・画像の最適化も使っていない。
  つまり **Next は実質「静的ファイルの配信とルーティング」しかしていない**
- **ファイルの中身はサーバーを通らない**（CLAUDE.md ルール 10）。転送量はストレージから直接出る
- **Redis に入るものは全部作り直せる**（presence / typing は TTL、Pub/Sub は at-most-once 前提、ws-ticket は短命、失効イベントは REST の検証で最終的に追いつく。ルール 4、ADR 0007 / 0016）

## 決定

### 1. Fly.io の 1 リージョン（`nrt`）にまとめる

| 役割 | 置き場所 | 形 |
|---|---|---|
| Go サーバー（API / WebSocket） | Fly app | 既存の `Dockerfile` の `prod` ステージ |
| Next.js | Fly app | `output: "standalone"` のコンテナ |
| Storybook | Fly app | `storybook build` の静的出力を Caddy で配る |
| Postgres | Fly app + ボリューム | **自前**（下の 5） |
| Valkey | Fly app | **自前**（下の 6） |
| オブジェクトストレージ | Cloudflare R2 | ADR 0008 の暫定を本決まりにする（下の 7） |

同じ組織・同じリージョンに置くので、DB と Redis へは Fly の private network で届く。
**リージョン間の private network は 2026-02 から課金対象**になるので、跨がない構成にしておく。

### 2. ドメインは 1 つ取り、サブドメインで分ける

```
app.<独自ドメイン>   Next.js
api.<独自ドメイン>   Go サーバー（WebSocket もここ）
ui.<独自ドメイン>    Storybook
```

- 同じ登録可能ドメインなので、**refresh の Cookie（`SameSite=Strict`）が載る**
- オリジンは違うので、**CORS（ADR 0021）と WebSocket の Origin 検査（ADR 0015）はいまのまま**変えない
- Cookie は host-only（`Domain` 属性なし）で `Path=/api/v1/auth` なので、`ui.` には飛ばない
- `ui.` は `noindex` にする（モックデータしか載らないが、検索に出す理由もない）

### 3. フロントエンドも Fly に置く（Vercel を使わない）

Next は standalone のコンテナにして、Go と同じように `fly deploy` する。

### 4. Storybook は静的サイトとして配る

`storybook build` の出力（`storybook-static/`）を、Caddy の入った小さなイメージに入れて配る。
サーバーの処理がないので、**アクセスがなければマシンを止めてよい**（`auto_stop_machines`）。
Storybook そのものの導入（`/dev/preview` からの移行、撮影と 1 対 1 の検査の移し方）は**別の ADR で決める**。

### 5. Postgres は自前（Fly マシン + ボリューム）で持つ

- バックアップは **`pg_dump` を日次で R2 の別バケットに置く**（本体の添付とは別のバケット。同じ S3 API で書ける）
- **復旧の手順を `docs/deploy.md` に書き、実際に 1 回戻すまで「バックアップがある」と言わない**
- Fly のボリュームのスナップショットは保険として使うが、保持期間が短いのでこれだけに頼らない
- 手に負えなくなったら Fly Managed Postgres（$38/月〜）に移す。**接続文字列の差し替えで済む**ように、
  アプリ側は `DATABASE_URL` しか知らない状態を保つ

### 6. Redis は Valkey 1 台を自前で持つ

- **永続化（RDB / AOF）は要らない。** 中身は全部作り直せる（背景）。落ちたら presence が消え、Pub/Sub の取りこぼしは
  再接続の差分（`after_seq` / `after_change_seq`）が埋める。これは設計時からの前提（ルール 4）
- ボリュームも付けない。マシンが入れ替わったら空から始める
- Redis ではなく Valkey にするのは、Redis のライセンス変更（2024）以降も BSD のまま使えるため。
  使っているのは `GET`/`SET`/`EXPIRE`/`PUBLISH`/`SUBSCRIBE` の範囲なので、クライアント（`go-redis`）も設定も変えずに繋がる

### 7. オブジェクトストレージは Cloudflare R2 で確定する

ADR 0008 の「本番は R2 が暫定の第一候補」を**本決まり**にする。

- バケットは 2 つ: 添付ファイル用と、DB のバックアップ用
- **バケットに CORS を設定する**（ブラウザから直接 PUT / GET するため）。許可オリジンは `APP_BASE_URL`（= `app.<ドメイン>`）
- 設定は `Endpoint=https://<アカウントID>.r2.cloudflarestorage.com` / `Region=auto` / `UsePathStyle=false` と認証情報だけ。
  **コードの変更はない**（`internal/platform/storage` が S3 API 抽象で、ローカルの MinIO と同じ経路）

### 8. 今回決めないこと

- **同一オリジン化**（`<ドメイン>/api/*` を Go に振り、Cookie と CORS の話を消す）。筋はいいが、ADR 0015 / 0021 が
  別オリジン前提で組んであるので、やるなら設計変更として別に決める
- CDN を前に置くこと、複数リージョン、read replica

## 理由

- **Vercel を使わない理由**: Vercel の強み（Next の実行環境・ISR・エッジ SSR・画像の最適化）が、**この構成では 1 つも効かない**。
  画面は全部ログイン必須でデータはクライアント取得、画像は署名付き URL でストレージから直接（ルール 10）。
  得られるのは実質「静的配信とプレビューデプロイ」なので、そのためにベンダーを 1 つ増やさない。
  ドメイン・証明書・ログ・監視が 1 か所にまとまる方を採る。
- **Neon を使わない理由**: **東京リージョンがない**（APAC は Singapore と Sydney）。
  このアプリは 1 リクエストで複数のクエリをトランザクション内で投げるので、往復 70ms が何度も乗る。
  アプリを Singapore に寄せれば DB は近くなるが、今度は利用者全員に遅延が乗る。
  Neon の売り（scale to zero・ブランチ）も、**WebSocket を張り続ける常駐プロセスでは効かない**。
- **DB と Redis を自前にする理由**: このプロジェクトの目的は「バックエンドを自分で実装して学ぶ」ことで、
  **バックアップと復旧の手順を持つこと自体が学習項目**になる。費用（数ドル/月 対 $38/月〜）はその次。
  同じ private network に入るので、遅延は管理サービスと同等かそれ以上に速い。
- **R2 にする理由**: **egress が無料**で、無料枠が 10 GB + Class A 100 万 + Class B 1000 万/月。
  画像をサーバーを通さず直接配る設計では転送が全部ストレージから出るので、ここが効く。
  S3 API で署名付き URL・`response-content-disposition`・HEAD 検証が揃っていて、`platform/storage` がそのまま通る。

## 検討した代替案

- **フロントを Vercel に置く**: プレビューデプロイが付くのは実際に価値がある（各フェーズの「オーナーによる実物での確認」に使える）。
  ただしそれ以外の強みが効かず、ベンダーが増える。プレビューが必要になったら、その 1 点のために見直す。
- **フロントを Cloudflare Pages に置く**: `@opennextjs/cloudflare`（peer は `next >= 16.3.3` なので 16.3.5 は範囲内）が要る。
  アダプタ越しの Next は Node ランタイムの差を踏む可能性があり、SSR をほぼ使わないこの構成では見返りが小さい。
- **Fly Managed Postgres**: バックアップ・HA・監視を買える。$38/月〜。運用が重くなったらここに移る（決定 5）。
- **Supabase / Crunchy Bridge**: 東京リージョンがあるので Neon の問題はない。Fly の private network の外に出るぶん、
  遅延と障害の切り分けが増える。
- **Upstash for Redis（Fly の拡張）**: `fly redis create` で済む。永続性を必要としない用途に従量課金を払う理由が薄い。
- **Tigris（Fly のオブジェクトストレージ）**: `fly storage create` で認証情報まで入り、egress も無料。
  無料枠が R2 より小さく（5 GB / Class A 1 万）、ストレージだけは Fly に縛られない方がよいので R2 を採る。
- **Vercel Blob**: S3 API を話さないので `platform/storage` に差せない。CLAUDE.md の「やってはいけないこと」にも入っている。
- **AWS S3**: IAM やライフサイクルの知識は実務的だが、**転送に $0.09/GB** かかる。直配りの設計と噛み合わない。

## 結果（トレードオフ）

- **運用は全部こちら持ちになる。** DB が壊れたら自分で戻す。復旧を 1 回試すまでは「バックアップがある」と言わない。
- **プレビューデプロイがない。** PR ごとに動く URL は出ないので、実物の確認はローカルか本番で行う。
- 費用の目安は**月 $10〜20**（マシン数台 + ボリューム。R2 は無料枠の内側）。Managed Postgres に移すと +$38/月。
- **東京 1 リージョン**。日本の外からは遅い。複数リージョンにするなら、Postgres の read replica から考え直しになる。
- R2 の署名付き URL のドメインは `*.r2.cloudflarestorage.com` に固定される（ADR 0008 の既知の制約）。
- Valkey が再起動すると presence が一斉に消える。数十秒で各クライアントの再送で戻るが、その間はオンラインの点が消える。
- 独自ドメインの取得と更新が要る（`*.fly.dev` では成立しない）。

## 追記: ドメインの取得（2026-09-22）

- **ドメインは `hibari-chat.com`**（`hibari.com` は取得済みで取れなかった）。決定 2 のとおり `app.` / `api.` / `ui.` をこの下に置く。
- **取得先は Cloudflare Registrar**（オーナーが比較を見て決定）。
  - 更新の料金が原価で、上乗せがない（Squarespace Domains は `.com` の更新が年 $20）
  - R2（決定 7）と同じアカウントにまとまる
  - DNS のレコードの種類に制限がない（Squarespace の自前の DNS は種類に制限があるとされる）
  - 引き換えに、**DNS は Cloudflare に固定される**（Registrar のドメインはほかのネームサーバーを使えない）。移るにはドメインごと移管する
  - `.jp` は Cloudflare Registrar で取れなかったので、`.com` にした。`.com` は迷惑メールの判定でも不利になりにくい（確認メールが届かないと使い始められない。ADR 0053）
- **Fly に向けるレコードは DNS only（Cloudflare のプロキシを通さない）。** 前段は Fly のプロキシだけにする。
  Cloudflare を通すと Fly の証明書の自動発行とぶつかり、クライアントの IP の取り方（ADR 0017、`TRUSTED_PROXIES`）も変わる。
- DNS のレコードの一覧と手順は `docs/deploy.md` の「ドメインと DNS」。

## 参考

- https://developers.cloudflare.com/r2/pricing/
- https://fly.io/docs/mpg/
- https://neon.com/docs/introduction/regions

## 状態の履歴

- 2026-09-20: 置き場所（Fly の 1 リージョン + R2）、DB と Redis を自前にすること、ドメインの分け方について
  オーナーの判断を取り、採用。デプロイの手順そのものは Phase 7 で書く。
- 2026-09-22: ドメイン（`hibari-chat.com`）と取得先（Cloudflare Registrar）を追記。
