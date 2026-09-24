# 0064. ドキュメントサイト（`docs.hibari-chat.com`。`docs/` を正本のまま Fumadocs で配り、REST の API リファレンスは Go の型から OpenAPI を生成する）

- 状態: 採用
- オーナーの確認: 2026-09-24
- 日付: 2026-09-24

## 背景

LP とは別に、フロントエンドとバックエンドの両方を説明するドキュメントサイトが欲しい（オーナーの要望: 2026-09-24）。

### オーナーと決めたこと（2026-09-24）

- 読者は開発者（設計を読みに来る人）。中身は**設計の読み物と、REST の API リファレンス**。利用者向けのヘルプは作らない。
- 置き場所は `docs.hibari-chat.com`。LP（ADR 0063）の Next.js には載せない。
- 検索エンジンには載せない。
- 生成器は Fumadocs（下の「生成器の比較」を見て決めた）。

### いまあるもの

| 中身 | 場所 | 形 |
|---|---|---|
| 設計判断 | `docs/adr/` | Markdown |
| アーキテクチャ・データモデル | `docs/architecture.mermaid`、`docs/erd.mermaid` | mermaid と、生成した SVG |
| WebSocket のイベント | `docs/events.md` | Markdown |
| フェーズの計画 | `docs/roadmap.md` | Markdown |
| デプロイの手順 | `docs/deploy.md` | Markdown |
| 画面仕様・トークン | `docs/ui/` | Markdown と PNG |
| コンポーネント | Storybook（`ui.hibari-chat.com`） | 静的サイト |
| REST の型 | `internal/httpx` の Go の型 → `web/lib/api/types.gen.ts`（`tsgen_test.go`） | 生成 |

- `docs/` の Markdown は 70 本。front matter はなく、GitHub で読む前提で書いている（表、`(0011-….md)` の相対リンク、本文の `{sender}` や `<@ULID>`）。
- REST のエンドポイントは 77 個（`internal/httpx` の `mux.Handle` / `mux.HandleFunc`）。OpenAPI はない。
- リポジトリは公開している。`docs/` をサイトにしても、新しく外に出る情報はない。

### 生成器の比較（2026-09-24 に実物で確かめた）

4 つの生成器で、実際の `docs/` を読む試作を同じ条件で作った（`docs/` を写さずに読む、front matter なし、同じ OpenAPI 3.1 のサンプル）。
検索は、ビルドした索引に対して 7 語（招待リンク、既読、冪等性、再接続、seq、署名付き URL、owner の譲渡）を実際に引き、上位 3 件が `docs/adr/README.md` の題名に照らして妥当かを見た。

| 観点 | Starlight 0.42 | VitePress 1.6 | Docusaurus 3.10 | Fumadocs 16 |
|---|---|---|---|---|
| 70 本をそのまま読めるか | ○ 失敗 0 | △ 回避策が設定で約 60 行（`.md` から `vue` を解決できない、生の HTML で落ちる） | △ 既定の MDX では 4 本が落ちる（`{sender}` を式として評価）。`format: 'detect'` で通る | ○ 失敗 0（`.md` は CommonMark として読む） |
| GitHub 用の書き方がそのまま出るか | ◎ | × 地の文の `{{ }}` を黙って評価する。行末の `{x}` が属性として消える | △ `detect` にすれば出る | ◎ |
| 相対リンク | ○ 自作 31 行 | ◎ 0 行 | ◎ ただし URL から ADR の番号が消える | ○ 5 行 |
| サイドバーの自動生成 | × `src/content/docs` の外を読むと、エラーなしで空になる | × 機能がない | ◎ | ○（フォルダ名が「Adr」になる） |
| 日本語の検索 | △ Pagefind がカタカナの複合語を分けそこない、「ワークスペース」が 43 ファイル中 1 件しか出ない。設定では直らなかった | 既定は △（前方一致だけで語の途中を落とす）。bigram にすると ◎（12 語すべて grep と一致） | △ 語は拾うが、「招待リンク」で ADR 0006 が 9 位 | 既定は ×（日本語 0 件）。`multilingual` にすると ○ |
| OpenAPI | ○ 検索にも入る | △ 操作のページが検索に入らない | ○ ただし JS が 5.2MB 増える | ○ 検索にも入る。パスのとおりに入れ子になる |
| トークン | どれも `globals.css` をそのまま読むと `@theme` が効かない。変数だけ抜き出す処理（22〜30 行）が要る ||||
| 依存 / 初回のビルド / 出力 | 229MB / 2.5 秒 / 6MB | 177MB / 5〜7 秒 / 18MB | 569MB / 8.7 秒 / 21MB | 524MB / 10 秒 / 54MB |
| 保守 | 0.x で 3 か月に 15 回。破壊的変更が多い | 安定版が 13 か月止まり、2.0 は alpha | 安定。マイナーは半年ごと | 本体は 1 年に 139 回。`fumadocs-mdx` と `fumadocs-openapi` はメジャーが 1 年に 3 回 |

どの生成器でも、`roadmap.md` の地の文にあった生の `<script>` が問題になった（本物のタグとして出る、ビルドが落ちる、黙って消える）。
GitHub でもこの文字は消えて見えていたので、`docs/` の側をバッククォートで囲んで直した（この ADR と同じ PR）。

## 決定

### 1. `docs/` が正本。サイトは読むだけ

- サイトのためにファイルを写さない。サイトの生成器が `docs/` を直接読む。GitHub で読んでもサイトで読んでも同じ文章になる。
- 新しく書く説明（下の決定 3 の「新規」）も `docs/` に置く。サイトのディレクトリに置くのは、設定・トップページ・見た目・サイトのコードだけ。
- **`docs/` の書き方は、GitHub の Markdown のまま変えない。** サイトの都合で front matter や `meta.json` を `docs/` に足さない。

### 2. 生成器は Fumadocs。置き場所はリポジトリの `site/`

- `site/` に Next.js（App Router）と Fumadocs のプロジェクトを置き、`output: 'export'` で静的に書き出す。
- Node で動かし、`web/` と同じくホストで起動する（コンテナに入れない。CLAUDE.md「ローカル環境」）。`make site` で起動する。
- **版は厳密に固定する**（`^` を付けない）。Fumadocs は更新が多いので、上げるときは変更履歴を読んで意図して上げる（Lexical と同じ扱い。ADR 0052）。

サイトのコードで補うもの（試作で確かめた量）:

| 補うもの | やり方 |
|---|---|
| `docs/` を読む | `defineDocs({ dir })` にリポジトリの `docs/` を渡す。Turbopack は外のディレクトリを読まないので、`turbopack.root` をリポジトリのルートにする |
| 題名 | front matter がないので、スキーマの既定値を「最初の `# ` 見出し」にする（約 8 行）。本文の見出しと重なるので、ページ側では題名を描かない |
| `README.md` | slugs のプラグインで、フォルダの index（`/adr`、`/ui`）にする（5 行） |
| 相対リンク | `./` の付かない `(0011-….md)` も解決するように補う（5 行）。コードへのパス（`web/app/globals.css`）は GitHub の該当ファイルに向ける |
| サイドバーのフォルダ名 | 「Adr」「Ui」ではなく「設計判断（ADR）」「画面仕様」にする。`docs/` に `meta.json` を置かず、サイトのコードでページの木を直す |
| 日本語の検索 | 静的な検索の分割を `tokenizer: { language: 'multilingual' }`（`Intl.Segmenter`）にする。索引を作る側と引く側の両方 |
| 図 | `tools/render-diagrams.sh` が生成した `docs/*.svg` を、`site/` のページから import して貼る（ADR の中に mermaid のコードブロックはないので、サイトで mermaid を描く仕組みは要らない） |

- **`docs/` に生の HTML を書いたら落とす。** Fumadocs は `.md` の生の HTML を黙って捨てる（`roadmap.md` の `<script>` がそうだった）。
  消えたことに気づけないので、`docs/` を Markdown として解析し、コードの外に HTML があれば落ちるテストを `site/` に置き、CI で動かす。
- `next dev` がプロジェクトに `AGENTS.md` / `CLAUDE.md` を生成するので、止める（`agentRules: false`）。

### 3. 見た目は Fumadocs の既定に、ロゴと色だけ当てる

- Claude Design でサイトの画面は作らない（既定の見た目で足りる読み物のサイトのため）。
- **色だけを共有する。** `web/app/globals.css` から CSS 変数（ライトと `[data-theme="dark"]`）だけを抜き出して読み、Fumadocs の変数（`--color-fd-primary` など）を `var(--color-primary)` などに向ける。値を書き写さない（CLAUDE.md ルール 7）。
  - `globals.css` をそのまま import しない。hibari は Tailwind の既定のテーマを捨てているので（`--*: initial`）、Fumadocs の部品の `rounded-xl` や `shadow-lg` が黙って消え、文字の大きさも hibari の段階に変わって見出しが小さくなった（試作で確かめた）。
- ダークは hibari と同じく `data-theme` で切り替え、OS の設定には追従しない（`RootProvider` の `attribute: 'data-theme'`、`enableSystem: false`）。
- ロゴは ADR 0063 決定 6 で作るものを使う。

### 4. サイトの構成

| 節 | 中身 | 出どころ |
|---|---|---|
| はじめに | hibari とは何か、全体の図、技術スタック、読み方 | **新規**（`docs/guide/index.md`）。CLAUDE.md の「目的」「技術スタック」から書き起こす |
| バックエンド › アーキテクチャ | 全体の構成、auth と chat の分け方、Delivery | `docs/architecture.svg` ＋ **新規**（`docs/guide/backend.md`） |
| バックエンド › データモデル | ERD、seq と未読の考え方 | `docs/erd.svg` ＋ **新規**（`docs/guide/data-model.md`） |
| バックエンド › REST API | エンドポイントのリファレンス | **生成**（決定 5） |
| バックエンド › WebSocket | イベントのスキーマ、再接続と `after_seq` | `docs/events.md` |
| フロントエンド › 構成 | ディレクトリ、データ層（ストア・WS の再接続・楽観的更新） | **新規**（`docs/guide/frontend.md`）。ADR 0060 などから書き起こす |
| フロントエンド › デザイン | トークン、画面仕様 | `docs/ui/tokens.md`、`docs/ui/README.md` |
| フロントエンド › コンポーネント | Storybook へのリンク | `ui.hibari-chat.com` |
| 設計判断（ADR） | すべての ADR。一覧は `docs/adr/README.md` | `docs/adr/` |
| ロードマップ | フェーズと完了条件 | `docs/roadmap.md` |
| デプロイ | 本番の構成と手順 | `docs/deploy.md` |

- **新規**の 4 ページは、ADR を読まなくても全体がつかめる入口にする。詳しいことは ADR へリンクし、内容を ADR から写さない（2 か所で古くなるため）。

### 5. REST の API リファレンスは、Go の型から OpenAPI を生成する

`tsgen_test.go` と同じ仕組みで、`docs/api/openapi.json` を生成する。`make ts-types` と同じく `-update` で書き直し、CI では差分があれば落とす。

- **スキーマ**: TypeScript の生成に登録してある Go の型の表を、そのまま使う。変換の規則（ポインタは `null` を許す、`omitzero` は必須にしない、名前付きの string は `enum`）も TypeScript と同じにする。
  TypeScript と OpenAPI で型がずれることは、構造上起きない。
- **パス**: `internal/httpx` に、エンドポイントごとの表（メソッドとパス、`operationId`、tag、要約、リクエストの型、成功したときのステータスとレスポンスの型、返しうるエラー、認証が要るか）を置く。
  - `operationId` と tag は必ず付ける。付けないと、サイドバーがパスのとおりに「Api › V1 › Rooms › Roomid › Messages」と入れ子になり、URL も長くなる（試作で確かめた）。tag はドメインの単位（auth、workspaces、rooms、messages など）にする。
- **表の漏れを検査する**: `mux.Handle` / `mux.HandleFunc` に渡しているパターンを Go のソースから読み（`go/ast`。`tsgen_test.go` が const を読むのと同じ方法）、表と 1 対 1 になっていなければ落とす。
  エンドポイントを足して表に書き忘れたら、CI で分かる。
- **エラー**: RFC 9457 の problem の形を 1 つのスキーマにし、各エンドポイントは返しうるステータスだけを並べる。
- **認証**: Access Token の `bearerAuth`。refresh の Cookie（`/api/v1/auth/refresh`）は、Web クライアントの実装の詳細として説明に書く（CLAUDE.md ルール 2）。
- **描画**: `fumadocs-openapi` の `staticSource` で、操作ごとのページを仮想的に作る（MDX のファイルを生成してコミットしない）。サイドバーと検索に入る。
  「試しに送る」（playground）は出さない。サイトから本番の API を叩かせる理由がない。
- WebSocket のイベントは OpenAPI にも AsyncAPI にもしない。`docs/events.md` をそのまま載せる。

### 6. 配り方と検索エンジン

- `next build` の静的な出力を、Storybook と同じく Fly のアプリ（`nrt`、静的、`auto_stop_machines`）で配る（ADR 0046 決定 4 と同じ形）。
- **検索エンジンに載せない**（オーナーの判断: 2026-09-24）。Storybook と同じく、`robots.txt` を `Disallow: /` にする。
  秘密を含まない静的なサイトなので、`app.` のような noindex のヘッダは要らない（ADR 0063 決定 5 の Storybook と同じ理由）。sitemap は作らない。
  ADR 0063 決定 5 の表に、`docs.hibari-chat.com` を「載せない」として加える。
- LP のフッターと、アプリの設定の画面などからは、今回はリンクしない（LP のデザインに入れるかは Claude Design で決める）。

## 理由

- **`docs/` を正本のままにする**: CLAUDE.md の「設計の正本」の表を変えずに済む。サイトのために写すと、どちらが正しいか分からなくなる。
- **Fumadocs**:
  - **`docs/` の書き方を縛らない。** `.md` を CommonMark と GFM として読むので、GitHub で読むのと同じ結果になる。決定 1 の「書き方を変えない」を守れたのは、Starlight と Fumadocs だけだった。
    VitePress は地の文の `{{ }}` を黙って評価するので、`docs/` を書くたびに生成器のことを気にすることになる。
  - **日本語の検索が実用になる。** Starlight の「ワークスペース」が引けない問題は Pagefind の分割から来ていて、設定では直らなかった。
    このサイトでいちばん多く出てくる語の 1 つが引けないのは、読み物のサイトとして致命的。Docusaurus は語を拾うが、題名に語を含む ADR が上に来ない。
  - **`web/` と同じ道具で作れる。** Next.js 16、React、TypeScript、Tailwind v4。サイトのコード（試作で雛形を含めて約 350 行）を、アプリと同じ知識で読み書きできる。
  - **OpenAPI の操作のページが、サイトの検索とサイドバーに入る。** MDX のファイルを生成してコミットしなくてよい。
- **OpenAPI を Go の型から作る**: 77 個のエンドポイントの型は、すでに Go にあり、TypeScript の生成にも使っている。手で書く OpenAPI は 3 か所目の型の定義になり、ずれても気づけない。
  パスの表だけは手で書くが、漏れはソースとの照合で落とせる。
- **生成をテストにする**: TypeScript と同じく、非公開の型を reflect で読めるうえ、生成し直すのを忘れると `go test` で落ちる。

## 検討した代替案

- **LP の Next.js に MDX で載せる（`hibari-chat.com/docs`）**: オーナーの判断で採らない。検索・目次などを自分で作ることになるうえ、LP の変更とドキュメントの変更が同じアプリに絡む。
- **Starlight**: 最も軽い（依存 229MB、ビルド 2.5 秒、出力 6MB）。ただし、日本語の検索で「ワークスペース」が引けない（背景の比較）。
  検索の部品を差し替えれば直る見込みはあるが、確かめていないうえ、差し替えるなら Starlight を選ぶ利点が薄れる。
  `docs/` の外を読むとサイドバーの自動生成が黙って空になる点と、0.x で破壊的な変更が多い点も重い。
- **VitePress**: bigram にすれば検索は 4 つの中で最も正確で、相対リンクも何もせずに動く。
  ただし `{{ }}` の評価で `docs/` の書き方を縛るうえ、`docs/` の外に置くと `.md` から `vue` を解決できず、回避策が約 60 行要った。安定版は 13 か月止まっていて、2.0 は alpha。OpenAPI の操作のページが検索に入らない。
- **Docusaurus**: 最も安定していて、サイドバーの自動生成も相対リンクもそのまま動く。
  ただし既定の MDX では `docs/` の 4 本が落ちる。検索は関係の深いページが上に来ない。依存が最も重く（569MB）、OpenAPI の表示だけで JS が 5.2MB 増える。
- **OpenAPI を手で書き、実装を合わせる（スペックファースト）**: 型の定義が Go・TypeScript・OpenAPI の 3 か所になる。実装とのずれを検査するには、別に契約テストが要る。
- **swaggo（コメントの注釈から生成）**: 注釈はコンパイラにも検査にもかからないので、実装とずれても気づけない。
- **huma などの、ハンドラの形から OpenAPI を作るフレームワーク**: ハンドラの書き方を 77 個すべて変えることになる。`net/http` の `ServeMux` を使う方針（CLAUDE.md「技術スタック」）とも合わない。
- **登録をエンドポイントの表から行う（表から `mux.Handle` を呼ぶ）**: 漏れが構造上なくなる。ただ、いまの登録（`auth.go` などに分かれている）を全部書き直すことになる。ソースとの照合で十分に防げる。
- **Scalar や Redoc の単独のページで API リファレンスを出す**: サイトの検索とサイドバーに入らない。

## 結果（トレードオフ）

- **Fumadocs は更新が多い。** 版を固定し、上げるときにまとめて追従する。`fumadocs-mdx` と `fumadocs-openapi` はメジャーが 1 年に 3 回上がっているので、上げるたびに手が入る前提にする。
  周りの依存も入れ替わっている（検索が Orama から zbsearch に、`fumadocs-ui` が `@fumadocs/base-ui` に）。
- **出力が重い。** 試作で 54MB（1 ページの HTML が約 170KB。70 項目のサイドバーを毎ページ持つため）。静的な配信なので、Fly の容量と転送のほかに実害はない。
- **検索の索引を最初の検索で丸ごと読む。** 試作で 10MB（gzip で約 2MB）。`docs/` が増えると大きくなる。重くなったら、索引を分ける方法を別に考える。
- Next.js と Fumadocs が `site/` に加わり、`web/` とは別の `package.json` の依存を更新する手間が増える。
- パスの表の「レスポンスの型」が、ハンドラが実際に返す型と合っているかは検査しない。表の漏れは照合で落とせるが、型の書き間違いはレビューで見る。
- `docs/` にコードの外の HTML を書けなくなる（決定 2 のテストで落ちる）。GitHub でも消える書き方なので、実際に困ることはない。
- Fly のアプリが 1 つ増える（`auto_stop_machines` なので、読まれていないときは止まる）。

## オーナーと確定した内容（2026-09-24）

下の項目はすべて案のまま採用。

1. サイトの見た目は Fumadocs の既定に、ロゴと色だけ当てる。Claude Design では作らない（決定 3）。
2. OpenAPI を Go の型から生成し、パスの表の漏れはソースとの照合で検査する（決定 5）。
3. 新しく書く 4 ページ（はじめに・バックエンド・データモデル・フロントエンド）を `docs/guide/` に置く（決定 4）。
4. `docs/` にコードの外の HTML を書いたら CI で落とす（決定 2）。

## 実装の順序

1. **この ADR**（オーナーの確認）← 完了
2. OpenAPI の生成: パスの表、ソースとの照合、`docs/api/openapi.json`、`make` のターゲット、CI。テスト
3. `site/`: Fumadocs、`docs/` の読み込み、題名・リンク・サイドバーの補い、日本語の検索、API リファレンス、生の HTML の検査、`make site`、CI のビルド
4. `docs/guide/` の 4 ページ
5. 見た目（ADR 0063 のロゴが要る）
6. Fly のアプリ、`docs/deploy.md` に `docs.hibari-chat.com` の手順を足す
