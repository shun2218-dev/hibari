# hibari

Go 製のリアルタイムチャットアプリ。Slack / Discord 型の「ワークスペース → チャンネル」構成を持つ。

## 目的

オーナーがバックエンド、特に WebSocket を使ったリアルタイム設計を**自分で実装して学ぶ**ためのプロジェクト。

- 「動けばいい」コードではなく、**なぜその設計なのかがコードとコメントから読み取れる**状態を目指す。
- 設計判断は `docs/adr/` に残す。コードのコメントは「何をしているか」ではなく「なぜそうしているか」を書く。
- 作業はフェーズ単位で進める（`docs/roadmap.md`）。現在のフェーズの範囲外のものを先回りして作らない。

## 設計の正本

| ファイル | 役割 |
|---|---|
| `docs/architecture.mermaid` | アーキテクチャの正本 |
| `docs/erd.mermaid` | データモデルの正本 |
| `docs/*.svg` | 人間用のレンダリング結果。`tools/render-diagrams.sh` で mermaid から生成する。手で編集しない |
| `docs/roadmap.md` | フェーズ計画と完了条件（DoD） |
| `docs/adr/` | 設計判断の記録 |
| `docs/events.md` | WebSocket イベントのスキーマ（Phase 4 で作成） |
| `docs/ui/` | Claude Design から取り込んだ画面仕様（Phase 1.5 で作成） |

これらと矛盾する実装をしない。設計を変えたくなったら、**実装する前に**指摘してオーナーの確認を取る。

## 技術スタック

- 言語: Go 1.24 以降（go.mod の `tool` ディレクティブを使うため）
- HTTP: `net/http` の `ServeMux`（メソッドとパスのパターンマッチを使う）
- WebSocket: `github.com/coder/websocket`
- DB: PostgreSQL 16 / ドライバ `pgx` v5
- クエリ: `sqlc`（SQL を自分で書く。ORM は使わない）
- マイグレーション: `goose`
- ログ: `log/slog`（構造化ログ）
- ID: ULID（`oklog/ulid`）。DB には `uuid` 型で保存する
- パスワードハッシュ: Argon2id（`golang.org/x/crypto/argon2`）
- JWT: `github.com/lestrrat-go/jwx/v3`
- オブジェクトストレージ: S3 API（`aws-sdk-go-v2`）。ローカルは MinIO、本番は R2（暫定）
- フロント: Next.js（App Router / TypeScript / Tailwind CSS）。実装は Phase 6 から
- ローカル環境: Docker Compose（Postgres / Redis / MinIO / Go アプリ）
  - Next.js だけはコンテナに入れず、ホストで起動する。macOS の bind mount は遅く、`node_modules` がそこに直撃するため
  - Go のモジュールキャッシュとビルドキャッシュは named volume に置く
  - goose / sqlc などのツールは go.mod の `tool` で固定し、ホストへのグローバルインストールに依存しない

## アーキテクチャの絶対ルール

1. **auth と chat は同じバイナリに同居するが、パッケージは厳密に分ける。**
   `internal/chat` は `internal/auth` を import してはいけない。
   両者の接点は「`internal/platform/authn` が渡す検証済みの userID / sid」と「Redis 経由の失効イベント」の 2 つだけ。
   ws-ticket の発行と消費も `platform/authn` に置く（chat が auth の Redis キーを直接読まないようにするため）。
2. **認証はトークンを発行する。Cookie は Web クライアントの実装詳細にすぎない。**
   将来のネイティブアプリを見据え、Cookie が前提の設計にしない。
   クライアント種別による受け渡し方法の分岐は 1 箇所に閉じ込める。
3. **メッセージの順序は `created_at` で決めない。**
   ルームごとに単調増加する `seq` を採番し、それを順序の唯一の根拠にする。
4. **WebSocket だけでメッセージ配信を完結させない。**
   クライアントは最後に受信した seq を保持し、再接続時に REST（`after_seq`）で差分を取得する。
   Redis Pub/Sub は at-most-once なので、配信は落ちうる前提で設計する。
5. **presence / typing は Postgres に書かない。** Redis に TTL 付きで置く。
6. **メッセージ配信は「WebSocket に書き込む処理」ではなく「配信先を解決してから送る処理」として抽象化する。**
   `Delivery` インターフェースの裏に実装を隠す。将来 Push 通知も配信先の 1 つとして加わる前提。
7. **デザイントークンの正本は `web/app/globals.css` の CSS 変数だけ。**
   コンポーネント内に色・余白・角丸の値を直接書かない。
8. **権限の変更もリアルタイムに反映する。**
   キック、ロール変更、非公開ルームからの削除が起きたら、該当ユーザーの WS 購読をサーバー側で即座に解除し、イベントを配信する。
   WS 接続時の認可結果をキャッシュし続けない。
9. **認可は 1 箇所に集約する。**
   「このユーザーはこのワークスペース / ルームを読めるか・書けるか・管理できるか」は authz レイヤだけが判断する。ハンドラに散らさない。
10. **ファイルの中身は Go サーバーも Next.js も経由しない。**
    クライアントは署名付き URL でストレージに直接 PUT / GET する。サーバーは authz、URL の発行、アップロード後の検証（HEAD）だけを担う。
    ストレージへのアクセスは `platform/storage` の S3 API 抽象を通し、特定のベンダーの SDK に依存しない。

## ドメインモデルの要点

詳細は `docs/erd.mermaid` と `docs/adr/` を参照。

- **階層**: `workspaces` → `rooms`（kind: `public` / `private` / `dm`）→ `messages`（`kind`: 人の発言 `user` と、参加や名前の変更のログ `system`。ADR 0033）。
  コード上は `room` と呼び、UI の表示だけ「チャンネル」にする（Redis Pub/Sub のチャンネルや Go の channel と紛らわしくなるのを避けるため）。
- **ロール**: ワークスペース単位で `owner > admin > member`。ルーム単位のロールは持たない。
  - `canManage(actor, target)`: actor のロールが target より上
  - `canGrant(actor, role)`: 付与するロールが actor 以下で、かつ owner ではない
  - owner は常に 1 人で、昇格ではなく「譲渡」で移す。DB の部分 UNIQUE 制約で保証する。
- **招待**: ワークスペース単位の招待リンク。コードはハッシュだけを保存する。受け入れると、ワークスペースと `is_default` のルームに自動で参加する。
  作成できるのは admin 以上。`invite_policy = all_members` のときだけ member も作成できる。
- **閲覧権限**: public ルームは、ワークスペースのメンバーなら参加していなくても読める。投稿するには参加が必要。
  private / dm ルームはメンバーだけが読める。参加前の履歴も読める。
- **DM**: ワークスペース内に閉じる。同じ 2 人の DM は `dm_key` の UNIQUE 制約で 1 つに限る。メンバーは追加できない。
- **未読数**: `rooms.last_user_seq - room_members.last_read_user_seq`（人の発言だけを数えた番号。ADR 0033）。
  自分が送信したら自分の既読位置も進める。参加や名前の変更のシステムメッセージは seq を消費するが、この番号は進めないので未読にならない。
  削除済みメッセージも数に含まれるが、O(1) で求めるための許容した近似とする。
- **スレッド**: 返信は `thread_root_id` で親を指し、チャンネルのタイムラインには出さない。順序と同期はルームの `seq` / `change_seq` を共有する（チャンネルの seq は飛び飛びになる）。
  チャンネルの未読（`user_seq`）には数えず、スレッドの未読は `thread_seq` で数える。参加者は親の投稿者と返信した人（ADR 0036）。
- **冪等性**: `UNIQUE(room_id, sender_id, client_msg_id)`。重複した送信には既存のメッセージを 200 で返す。
- **スコープ外**: ブロック機能、グループ DM、ルーム単位のロール、カスタムロール。

## ディレクトリ構成

```
hibari/
  cmd/server/main.go
  internal/
    auth/          # 認証ドメイン（登録・ログイン・トークン発行・ローテーション）
    chat/          # チャットドメイン（ワークスペース・ロール・招待・ルーム・メッセージ・添付・Hub）
    platform/      # 横断的関心事
      authn/       #   JWT 検証ミドルウェア、ws-ticket、失効フック
      storage/     #   S3 API 抽象
      ...          #   config / db / redis / log / id / clock
    httpx/         # ルーティング、ミドルウェア、エラーレスポンス
  db/
    migrations/    # goose
    queries/       # sqlc の入力 SQL
  docs/
    adr/
    ui/            # Phase 1.5
  web/             # 骨組みは Phase 1、実装は Phase 6
  tools/
  compose.yaml
```

`internal/chat` をサブパッケージに分けるかどうかは Phase 3a で決める。

## コーディング規約

### Go 全般
- `context.Context` は第 1 引数で受け取る。構造体のフィールドに保持しない。
- グローバルな可変状態を持たない。依存はコンストラクタで注入する（DB、Redis、Clock、ID 生成器、Delivery など）。
- 時刻は必ず `Clock` インターフェースから取得する。`time.Now()` を直接呼ぶのは `platform` の実装だけ。
- ID は ULID 生成器から取得する。DB の既定値（`gen_random_uuid()` など）に頼らない。
- goroutine を起動したら、必ず終了条件（context のキャンセル、channel のクローズ）を用意する。リークしないことをテストで確かめる。
- JSON は `encoding/json/v2` を使う（v1 の import は lint で禁止。ADR 0023）。ポインタと bool の省略は `omitempty` ではなく `omitzero` にする。
- 命名は Go の慣習に従う（`userID`、`HTTPServer`、パッケージ名は短い単数形）。パッケージ名を繰り返す名前（`chat.ChatService`）にしない。

### エラーハンドリング
- エラーは `fmt.Errorf("...: %w", err)` で文脈を付けて包む。握りつぶさない。
- ドメイン層は sentinel error または型付きエラー（`ErrNotFound`、`ErrForbidden`、`ErrConflict` など）を返す。HTTP ステータスの知識を持たない。
- ドメインエラーから HTTP レスポンスへの変換は `internal/httpx` だけで行う。形式は RFC 9457（`application/problem+json`）。
- 認証の失敗では、ユーザーの存在有無が判別できるレスポンスや時間差を出さない。
- `panic` はプログラムのバグにだけ使う。リクエスト処理のエラーには使わない。

### ログ
- `log/slog` の構造化ログを使う。request_id / user_id / room_id などは属性として付ける。
- パスワード、トークン（Access / Refresh / ws-ticket / 招待コード / ワンタイムトークン）、メッセージ本文、署名付き URL をログに出さない。
  例外は開発用 Mailer がトークン付きの URL を出力する場合だけ。

### DB / SQL
- 列挙値は Postgres の enum 型ではなく `text` + `CHECK` 制約にする（値を変更するマイグレーションが楽なため）。
- 時刻はすべて `timestamptz`。
- 外部キーには `ON DELETE` の挙動を必ず明示する。
- マイグレーションは 1 テーブル 1 ファイルではなく、ドメイン単位でまとめる。
- ページネーションは seq や ULID によるカーソル方式にする。`OFFSET` を使わない。
- 一覧 API は N+1 クエリにならない形で書く。

### HTTP API
- パスは `/api/v1/...`。JSON のフィールド名は `snake_case`。
- ID は ULID の文字列表現で返す。
- `limit` には上限を設ける。

### テスト（実装とテストは常にセット）
- **テストのない実装をコミットしない。** バックエンドもフロントエンドも、振る舞いを追加・変更したら、同じコミット（少なくとも同じ PR）にテストを含める。
- バグを直すときは、まずそのバグを再現して失敗するテストを書き、それが通るように直す。
- PR を出す前にローカルで全テストと lint を通す。CI（GitHub Actions、Phase 1 で導入）が落ちている PR はマージしない。

**バックエンド（Go）**
- テーブル駆動テストを基本にする。
- DB を使う処理はモックにせず、実物の Postgres（compose または testcontainers）で統合テストする。
- 並行性が絡む処理（seq の採番、冪等性、招待リンクの使用回数、owner の譲渡、Hub）には、goroutine を多数立てる並行テストを書く。
- `go test -race` を常に通す。
- 時刻に依存するテストは `Clock` を固定する。`time.Sleep` で待たない。

**フロントエンド（web/）**
- ユニット / コンポーネントテスト: Vitest + React Testing Library。
- E2E: Playwright（Phase 6 で、ローカルの compose に対して実行する）。
- presentational コンポーネントは、status ごとの表示（pending / sent / failed / deleted など）をテストする。
- データ層（fetch ラッパーの単一フライトの refresh、WS の再接続と `after_seq` の同期、楽観的更新）はユニットテストを厚くする。

## Git 運用（Git Flow）

### ブランチ

| ブランチ | 役割 | 作成元 | マージ先 |
|---|---|---|---|
| `main` | 本番リリース。タグ `vX.Y.Z` はここに付ける | — | — |
| `develop` | 開発環境。次のリリースに向けた統合先 | `main` | — |
| `feature/<内容>` | 機能追加・ドキュメント・設定など通常の作業 | `develop` | `develop` |
| `bugfix/<内容>` | develop 上のバグ修正 | `develop` | `develop` |
| `release/vX.Y.Z` | リリース準備（バージョン更新のみ。機能を足さない） | `develop` | `main` と `develop` |
| `hotfix/vX.Y.Z` | 本番の緊急修正 | `main` | `main` と `develop` |

- **`main` と `develop` への直接のコミット・push は禁止。** 取り込みは必ず PR のマージで行う。
- `.githooks/` のフックがローカルで直接のコミットと push を止める（clone したら `git config core.hooksPath .githooks` を実行する）。GitHub 側でもブランチ保護を設定する。
- 作業を始めるときは、必ず `develop` の最新から作業ブランチを切る。
- ブランチ名は英小文字とハイフンで、作業内容を表す（例: `feature/dev-environment`、`feature/auth-refresh-rotation`）。フェーズ番号（`phase-1` など）は入れない。

### コミットメッセージ

Conventional Commits の形式にする: `<type>(<scope>): <要約>`（scope は省略可、要約は日本語で可）。

| type | 用途 |
|---|---|
| `feat` | 機能の追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみ |
| `test` | テストのみの追加・修正 |
| `refactor` | 振る舞いを変えない変更 |
| `perf` | 性能改善 |
| `build` | ビルド・依存関係・Docker |
| `ci` | CI の設定 |
| `chore` | 上記以外の雑務（リリース時のバージョン更新を含む） |

scope の例: `auth` / `chat` / `platform` / `httpx` / `db` / `web` / `docs` / `deps`。
1 コミット 1 論理変更にし、各コミットの時点でテストが通る状態を保つ。

### PR とマージ
- `feature/*` / `bugfix/*` → `develop`: **squash マージ**。PR のタイトルを Conventional Commits の形式にする。
- `release/*` / `hotfix/*` → `main` と `develop`: **マージコミット**（squash しない。main と develop の履歴を分岐させないため）。
- PR の説明には「何を・なぜ」「テスト内容」「関連する ADR / ロードマップのフェーズ」を書く。

### リリース手順
1. `develop` から `release/vX.Y.Z` を切る（SemVer。1.0.0 までは `0.Y.Z`）。
2. バージョンを更新する（`web/package.json` など）。コミットは `chore(release): vX.Y.Z`。Go のバイナリには、ビルド時に `-ldflags` でタグのバージョンを埋め込む。
3. `release/vX.Y.Z` → `main` の PR を作ってマージする。
4. `release/vX.Y.Z` → `develop` の PR を作ってマージする（リリースブランチでの変更を develop に戻す）。
5. `main` のマージコミットにタグ `vX.Y.Z` を付けて push する。
6. GitHub の Releases でリリースノートを作成する。
7. `release/vX.Y.Z` ブランチを削除する。

hotfix は `main` から `hotfix/vX.Y.Z` を切り、手順 2〜7 と同じ流れで進める。

## デザイン

- デザイントークンの正本は `web/app/globals.css` の CSS 変数だけ。各トークンの用途は `docs/ui/tokens.md`。
- コンポーネント内に色・余白・角丸・フォントサイズの値を直接書かない。Tailwind の任意値（例: `text-[#2F6F62]`、`p-[13px]`）も禁止。
- 新しいトークンが必要になったら、勝手に作らずオーナーに確認する。
- 画面の見た目は `docs/ui/` のスクリーンショットに従う。そこにない画面や状態を発明しない。足りなければ実装せずに指摘し、Claude Design 側に追加する。

### トークンの決まりごと
- 名前は役割ベースの `--color-*` / `--text-*` / `--radius-*` などにする（`--color-text-muted`、`--color-primary-subtle`）。Claude Design 上の名前（`--ink` / `--brand` / `--live`）はコードに持ち込まない。
- Tailwind の既定テーマは `@theme static { --*: initial; }` で捨ててある。`text-red-500` や `rounded-xl` は存在しない前提で書く。
- **緑（primary）= 操作できるもの、琥珀（attention）= いま起きていること。** 未読バッジ・入力中・接続状態に primary を使わない。琥珀の要素を押せるようにしない。
- 文字サイズは 7 段階（11 / 12 / 13 / 14 / 15 / 20 / 26px）。`text-base` は 14px（UI 部品）、メッセージ本文と入力欄は `text-lg`（15px）。行送りは本文が `leading-relaxed`（1.75）。
- 角丸は `rounded-sm`（8px）/ `rounded-md`（12px）/ `rounded-lg`（16px）/ `rounded-full` の 4 段階。余白とサイズは `--spacing`（4px）の倍数で書く。
- ダークテーマは `<html data-theme="dark">` で切り替える。OS の設定には追従しない。ダークの値は、ライトと同じ名前の変数を上書きして定義する（`globals.test.ts` がライトとダークで色トークンの集合が一致することを検査する）。
- presence はオンラインのドットだけ。離席や最終オンライン時刻は出さない（Redis に TTL だけで持つため）。

## やってはいけないこと

- `main` / `develop` に直接コミット・push する（PR のマージだけで取り込む）
- テストのない実装をコミットする
- CI が落ちている PR をマージする
- 現在のフェーズの範囲外の機能を先回りして実装する
- `docs/` の設計を黙って変更する（まず指摘する）
- `internal/chat` から `internal/auth` を import する
- `created_at` でメッセージをソートする
- WebSocket での配信だけを前提にして、差分取得の経路を省く
- presence / typing を Postgres に書く
- Access Token / Refresh Token を URL に載せる（WS 接続で URL に載せてよいのは短命の ws-ticket だけ）
- Refresh Token や招待コードの生値を DB に保存する
- JWT にロールや権限を入れる（失効できないため。ロールは DB を正とする）
- 未検証の email を根拠に、OAuth アカウントを既存アカウントへ自動で紐付ける
- 同じ WebSocket 接続に複数の goroutine から書き込む
- ORM を導入する
- Next.js の Route Handler にビジネスロジックを書く（refresh Cookie の薄いプロキシだけは例外）
- Access Token を localStorage に置く
- ファイルの中身を Go サーバーや Next.js 経由でプロキシする
- 特定のストレージベンダーの SDK（Vercel Blob、R2 独自 API など）に直接依存する
- Phase 1.5 より前に UI を作る
- `docs/*.svg` を手で編集する
