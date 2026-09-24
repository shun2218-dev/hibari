# 0064. ドキュメントサイト（`docs.hibari-chat.com`。`docs/` を正本のまま Starlight で配り、REST の API リファレンスは Go の型から OpenAPI を生成する）

- 状態: 提案
- 日付: 2026-09-24

## 背景

LP とは別に、フロントエンドとバックエンドの両方を説明するドキュメントサイトが欲しい（オーナーの要望: 2026-09-24）。

### オーナーと決めたこと（2026-09-24）

- 読者は開発者（設計を読みに来る人）。中身は**設計の読み物と、REST の API リファレンス**。利用者向けのヘルプは作らない。
- 置き場所は `docs.hibari-chat.com`。LP（ADR 0063）の Next.js には載せない。

### いまあるもの

| 中身 | 場所 | 形 |
|---|---|---|
| 設計判断 | `docs/adr/`（64 本） | Markdown |
| アーキテクチャ・データモデル | `docs/architecture.mermaid`、`docs/erd.mermaid` | mermaid と、生成した SVG |
| WebSocket のイベント | `docs/events.md` | Markdown |
| フェーズの計画 | `docs/roadmap.md` | Markdown |
| デプロイの手順 | `docs/deploy.md` | Markdown |
| 画面仕様・トークン | `docs/ui/` | Markdown と PNG |
| コンポーネント | Storybook（`ui.hibari-chat.com`） | 静的サイト |
| REST の型 | `internal/httpx` の Go の型 → `web/lib/api/types.gen.ts`（`tsgen_test.go`） | 生成 |

- REST のエンドポイントは 77 個（`internal/httpx` の `mux.Handle` / `mux.HandleFunc`）。OpenAPI はない。
- リポジトリは公開している。`docs/` をサイトにしても、新しく外に出る情報はない。

## 決定

### 1. `docs/` が正本。サイトは読むだけ

- サイトのためにファイルを写さない。サイトの生成器が `docs/` を直接読む。GitHub で読んでもサイトで読んでも同じ文章になる。
- 新しく書く説明（下の決定 3 の「新規」）も `docs/` に置く。サイトのディレクトリに置くのは、設定・トップページ・見た目だけ。
- ADR の中の相対リンク（`0011-invite-links.md`）はサイトの URL に、コードへのパス（`web/app/globals.css`）は GitHub の該当ファイルに、ビルドのときに書き換える。
  `docs/` の書き方は変えない。

### 2. 生成器は Astro の Starlight。置き場所はリポジトリの `site/`

- `site/` に Starlight のプロジェクトを置き、`docs/` を content collection の glob で読む。
- Node で動かし、`web/` と同じくホストで起動する（コンテナに入れない。CLAUDE.md「ローカル環境」）。`make site` で起動する。
- mermaid の図は、`tools/render-diagrams.sh` が生成した `docs/*.svg` をそのまま貼る（ADR の中に mermaid のコードブロックはないので、サイトで mermaid を描く仕組みは要らない）。
- 検索は Starlight に組み込みの Pagefind（静的な索引。サーバーは要らない）。
- 見た目: Starlight の既定の見た目に、ロゴ（ADR 0063 決定 6）と primary の色だけ当てる。
  色は `web/app/globals.css` の変数を読み込み、Starlight の変数（`--sl-color-accent` など）に割り当てる。値を書き写さない（CLAUDE.md ルール 7）。
  Claude Design でサイトの画面は作らない（既定の見た目で足りる読み物のサイトのため）。

### 3. サイトの構成

| 節 | 中身 | 出どころ |
|---|---|---|
| はじめに | hibari とは何か、全体の図、技術スタック、読み方 | **新規**（`docs/guide/index.md`）。CLAUDE.md の「目的」「技術スタック」から書き起こす |
| バックエンド › アーキテクチャ | 全体の構成、auth と chat の分け方、Delivery | `docs/architecture.svg` ＋ **新規**（`docs/guide/backend.md`） |
| バックエンド › データモデル | ERD、seq と未読の考え方 | `docs/erd.svg` ＋ **新規**（`docs/guide/data-model.md`） |
| バックエンド › REST API | エンドポイントのリファレンス | **生成**（決定 4） |
| バックエンド › WebSocket | イベントのスキーマ、再接続と `after_seq` | `docs/events.md` |
| フロントエンド › 構成 | ディレクトリ、データ層（ストア・WS の再接続・楽観的更新） | **新規**（`docs/guide/frontend.md`）。ADR 0060 などから書き起こす |
| フロントエンド › デザイン | トークン、画面仕様 | `docs/ui/tokens.md`、`docs/ui/README.md` |
| フロントエンド › コンポーネント | Storybook へのリンク | `ui.hibari-chat.com` |
| 設計判断（ADR） | すべての ADR。一覧は `docs/adr/README.md` | `docs/adr/` |
| ロードマップ | フェーズと完了条件 | `docs/roadmap.md` |
| デプロイ | 本番の構成と手順 | `docs/deploy.md` |

- **新規**の 4 ページは、ADR を読まなくても全体がつかめる入口にする。詳しいことは ADR へリンクし、内容を ADR から写さない（2 か所で古くなるため）。

### 4. REST の API リファレンスは、Go の型から OpenAPI を生成する

`tsgen_test.go` と同じ仕組みで、`docs/api/openapi.json` を生成する。`make ts-types` と同じく `-update` で書き直し、CI では差分があれば落とす。

- **スキーマ**: TypeScript の生成に登録してある Go の型の表を、そのまま使う。変換の規則（ポインタは `nullable`、`omitzero` は必須にしない、名前付きの string は `enum`）も TypeScript と同じにする。
  TypeScript と OpenAPI で型がずれることは、構造上起きない。
- **パス**: `internal/httpx` に、エンドポイントごとの表（メソッドとパス、要約、リクエストの型、成功したときのステータスとレスポンスの型、返しうるエラー、認証が要るか）を置く。
- **表の漏れを検査する**: `mux.Handle` / `mux.HandleFunc` に渡しているパターンを Go のソースから読み（`go/ast`。`tsgen_test.go` が const を読むのと同じ方法）、表と 1 対 1 になっていなければ落とす。
  エンドポイントを足して表に書き忘れたら、CI で分かる。
- **エラー**: RFC 9457 の problem の形を 1 つのスキーマにし、各エンドポイントは返しうるステータスだけを並べる。
- **認証**: Access Token の `bearerAuth`。refresh の Cookie（`/api/v1/auth/refresh`）は、Web クライアントの実装の詳細として説明に書く（CLAUDE.md ルール 2）。
- **描画**: Starlight のプラグイン `starlight-openapi` で、エンドポイントごとのページを作る。サイドバーと検索に入る。
- WebSocket のイベントは OpenAPI にも AsyncAPI にもしない。`docs/events.md` をそのまま載せる。

### 5. 配り方と検索エンジン

- `astro build` の静的な出力を、Storybook と同じく Fly のアプリ（`nrt`、静的、`auto_stop_machines`）で配る（ADR 0046 決定 4 と同じ形）。
- **検索エンジンに載せない**（オーナーの判断: 2026-09-24）。Storybook と同じく、`robots.txt` を `Disallow: /` にする。
  秘密を含まない静的なサイトなので、`app.` のような noindex のヘッダは要らない（ADR 0063 決定 5 の Storybook と同じ理由）。sitemap は作らない。
  ADR 0063 決定 5 の表に、`docs.hibari-chat.com` を「載せない」として加える。
- LP のフッターと、アプリの設定の画面などからは、今回はリンクしない（LP のデザインに入れるかは Claude Design で決める）。

## 理由

- **`docs/` を正本のままにする**: CLAUDE.md の「設計の正本」の表を変えずに済む。サイトのために写すと、どちらが正しいか分からなくなる。
- **Starlight**: Markdown のファイルをそのまま読める。検索（Pagefind）とサイドバーが組み込みで、API リファレンスのプラグインがある。静的に出せるので、Storybook と同じ配り方ができる。
- **OpenAPI を Go の型から作る**: 77 個のエンドポイントの型は、すでに Go にあり、TypeScript の生成にも使っている。手で書く OpenAPI は 3 か所目の型の定義になり、ずれても気づけない。
  パスの表だけは手で書くが、漏れはソースとの照合で落とせる。
- **生成をテストにする**: TypeScript と同じく、非公開の型を reflect で読めるうえ、生成し直すのを忘れると `go test` で落ちる。

## 検討した代替案

- **LP の Next.js に MDX で載せる（`hibari-chat.com/docs`）**: オーナーの判断で採らない。検索・目次・mermaid の描画を自分で作ることになるうえ、LP の変更とドキュメントの変更が同じアプリに絡む。
- **VitePress**: 軽くて Markdown を読めるが、組み込みの検索（MiniSearch）は日本語を語に分けられない。API リファレンスは別の道具を組み込むことになる。
- **Docusaurus**: React で web と同じ言葉で書けるが、重い。組み込みの検索がなく、ローカル検索はプラグインに頼る。
- **OpenAPI を手で書き、実装を合わせる（スペックファースト）**: 型の定義が Go・TypeScript・OpenAPI の 3 か所になる。実装とのずれを検査するには、別に契約テストが要る。
- **swaggo（コメントの注釈から生成）**: 注釈はコンパイラにも検査にもかからないので、実装とずれても気づけない。
- **huma などの、ハンドラの形から OpenAPI を作るフレームワーク**: ハンドラの書き方を 77 個すべて変えることになる。`net/http` の `ServeMux` を使う方針（CLAUDE.md「技術スタック」）とも合わない。
- **登録をエンドポイントの表から行う（表から `mux.Handle` を呼ぶ）**: 漏れが構造上なくなる。ただ、いまの登録（`auth.go` などに分かれている）を全部書き直すことになる。ソースとの照合で十分に防げる。
- **Scalar や Redoc の単独のページで API リファレンスを出す**: サイトの検索とサイドバーに入らない。

## 結果（トレードオフ）

- Astro と Starlight が技術スタックに加わる。`site/` の依存を更新する手間が増える（`web/` とは別の `package.json`）。
- パスの表の「レスポンスの型」が、ハンドラが実際に返す型と合っているかは検査しない。表の漏れは照合で落とせるが、型の書き間違いはレビューで見る。
- ADR の相対リンクとコードへのパスを書き換える処理を、自分で持つことになる（remark のプラグイン）。
- Fly のアプリが 1 つ増える（`auto_stop_machines` なので、読まれていないときは止まる）。

## オーナーに確認したいこと

1. 生成器を Starlight にする（決定 2）。
2. サイトの見た目は Starlight の既定に、ロゴと primary の色だけ当てる。Claude Design では作らない（決定 2）。
3. OpenAPI を Go の型から生成し、パスの表の漏れはソースとの照合で検査する（決定 4）。
4. 新しく書く 4 ページ（はじめに・バックエンド・データモデル・フロントエンド）を `docs/guide/` に置く（決定 3）。

## 実装の順序

1. **この ADR**（オーナーの確認）
2. OpenAPI の生成: パスの表、ソースとの照合、`docs/api/openapi.json`、`make` のターゲット、CI。テスト
3. `site/`: Starlight、`docs/` の読み込み、リンクの書き換え、API リファレンス、`make site`、CI のビルド
4. `docs/guide/` の 4 ページ
5. 見た目（ADR 0063 のロゴが要る）
6. Fly のアプリ、`docs/deploy.md` に `docs.hibari-chat.com` の手順を足す
