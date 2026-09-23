# hibari ロードマップ

各フェーズは新しいセッションで始める。前提は `CLAUDE.md` と `docs/` に揃っている。
フェーズが終わるたびに `git diff` を自分の目で読み、完了条件（DoD）を自分で確認してから次へ進む。

```
Phase 0    設計の文書化（コードなし）                     ← 完了
Phase 1    基盤・スキーマ・web/ の骨組み
Phase 1.5  デザインの取り込みとトークンの確定（実装フェーズではない）
Phase 2    認証
Phase 3a   ワークスペース / ロール / 招待 / ルーム
Phase 3b   メッセージの REST API
Phase 3c   添付ファイル
Phase 4    WebSocket（単一インスタンス）
Phase 5    水平スケール（Redis Pub/Sub）
Phase 6    Next.js クライアント
Phase 6.4  システムメッセージ
Phase 6.5  スレッド
Phase 6.6〜6.16  Slack と同じ使い心地にする（チャンネルにも投稿・リアクション・離席とステータス・プロフィール・書式・リンク・ピン留め・メンション・通知・アクティビティ・アーカイブ・検索）
Phase 7〜  任意
```

---

## プロンプト集との差分（Phase 0 で確定した変更）

事前に用意したフェーズ別プロンプトは、次のように読み替えて使う。

| プロンプト集の記述 | 確定した内容 | 根拠 |
|---|---|---|
| Go 1.23 以降 | **Go 1.24 以降** | go.mod の `tool` ディレクティブが必要 |
| `rooms.next_seq` | **`rooms.last_message_seq`（初期値 0）だけを持つ** | ADR 0002 |
| `UNIQUE(room_id, client_msg_id)` | **`UNIQUE(room_id, sender_id, client_msg_id)`** | 他人の client_msg_id で既存メッセージを引き出せないようにする |
| `since_seq` | **`after_seq` / `before_seq`** | 表記の統一 |
| ルームはユーザー直下（dm / group） | **ワークスペース配下（public / private / dm）** | ADR 0006 |
| Phase 3（チャット REST） | **3a / 3b / 3c に分割** | 範囲が大きくなったため |
| `POST /api/v1/rooms` | **`POST /api/v1/workspaces/{id}/rooms`** | ルームはワークスペースに属する |
| `POST /api/v1/auth/ws-ticket` | **`POST /api/v1/ws/ticket`（実装は `platform/authn`）** | ADR 0007 |
| JWT クレーム `sub, jti, iat, exp, iss, aud` | **`sid` を追加** | セッション単位で失効させるため（ADR 0007） |
| 失効イベントは userID 単位 | **sid 単位（全セッション失効時は userID 単位）** | ADR 0007 |
| 添付ファイルは Phase 7 以降 | **Phase 3c に前倒し** | ADR 0008 |
| Tauri は Phase 6 | **Phase 7 以降** | Phase 6 は Next.js |
| Phase 4 の差分取得は `after_seq` | **`after_change_seq`（編集・削除も含む）** | ADR 0014 |
| 購読はルームだけ | **ワークスペースとルーム** | ADR 0015 |
| Phase 5 の購読はルームとユーザー | **ルーム・ワークスペース・ユーザー** | ADR 0016 |
| `tools/gen_*.py` で SVG 生成 | **`tools/render-diagrams.sh`（mermaid-cli）** | Python 版は mermaid を読んでいなかった |
| Dockerfile の `:delegated` | **不要**（現行の Docker Desktop では無視される） | — |

---

## Phase 0 — 設計の文書化

**成果物**: `CLAUDE.md`、`docs/roadmap.md`、`docs/adr/`、更新した `docs/*.mermaid`

**DoD**
- [x] mermaid の矛盾・抜けを洗い出し、判断を確定した
- [x] 設計判断を ADR に記録した
- [x] `tools/render-diagrams.sh` で SVG を再生成した
- [x] Git Flow の運用ルールを CLAUDE.md に定めた

---

## Phase 1 — 基盤・スキーマ・web/ の骨組み

**やること**
- `compose.yaml`（postgres:16 / redis:7 / minio / server）と `.env.example`
  - server はホスト側のポート番号や固定のコンテナ名に依存させない（Phase 5 の `--scale` のため）
- マルチステージの Dockerfile（dev: air / build: CGO_ENABLED=0 / prod: distroless）
  - `/go/pkg/mod` と `/root/.cache/go-build` は named volume に置く
- Makefile（up / down / logs / ps / sh / psql / migrate-up / migrate-down / migrate-new / sqlc / test / lint / web / keys / diagrams）
- go.mod の `tool` で goose / sqlc のバージョンを固定する
- `docs/erd.mermaid` に対応する goose マイグレーション（ドメイン単位でまとめる）
  - 必須のインデックスと制約
    - `messages`: `UNIQUE(room_id, seq)`、`UNIQUE(room_id, sender_id, client_msg_id)`、`UNIQUE(room_id, id)`、`INDEX(room_id, seq DESC)`
    - `messages`: `(room_id, reply_to_id)` → `messages(room_id, id)` の複合 FK
    - `room_members`: `PRIMARY KEY(room_id, user_id)`、`INDEX(user_id)`
    - `workspace_members`: `PRIMARY KEY(workspace_id, user_id)`、`INDEX(user_id)`、owner の部分 UNIQUE
    - `rooms`: name と dm_key の部分 UNIQUE、`INDEX(workspace_id, last_message_at DESC)`
    - `refresh_tokens`: `UNIQUE(token_hash)`、`INDEX(family_id)`
    - `one_time_tokens` / `workspace_invites` / `attachments`: ハッシュまたはキーの UNIQUE
    - `citext` 拡張の作成
  - すべての FK に `ON DELETE` を明示する
- `internal/platform`: config / slog / pgx プール / Redis / ULID / Clock
- `cmd/server/main.go`: graceful shutdown
- `GET /healthz`（DB と Redis への疎通を含む）
- `web/` の骨組み（create-next-app 相当、`globals.css` はプレースホルダ、`.nvmrc`、API のベース URL は環境変数から読む）
- web/ にテスト基盤（Vitest + React Testing Library）を入れ、トップページの最小テストを 1 本置く
- GitHub Actions の CI（PR ごとに実行）
  - Go: `go vet` / lint / `go test -race`（Postgres と Redis はサービスコンテナ）
  - マイグレーションと sqlc: `migrate-up` が通り、`sqlc generate` の結果に差分がないこと
  - web: lint / 型チェック / Vitest
- GitHub のブランチ保護（`main` と `develop`: PR 必須・CI 必須・直接 push 禁止）
- seq の採番方式を ADR 0002 に追記して確定する（`UPDATE rooms SET last_message_seq = last_message_seq + 1 ... RETURNING` を想定。より良い案があれば実装前に提案する）

**DoD**
- [ ] `make up` でコンテナが全部立ち上がる
- [ ] `make migrate-up && make sqlc` がエラーなく通る
- [ ] `curl localhost:8080/healthz` が 200 を返す
- [ ] Go のソースを編集すると air が数秒で再起動する
- [ ] `make web` でホストの Next.js が起動し、コンテナの API に到達できる
- [ ] ホストに Go / goose / sqlc / psql がなくても上記が全部通る
- [ ] PR で CI が走り、Go と web のテストが通る
- [ ] スキーマについて、なぜその型・制約にしたかを説明できる

---

## Phase 1.5 — デザインの取り込み（実装フェーズではない）

**目的**: デザインとコードの接点を `web/app/globals.css` の 1 箇所に固定する。

**成果物**: `docs/ui/`（スクリーンショット、README、tokens.md）と `web/app/globals.css` だけ。React コンポーネント、ページ、API クライアントは作らない。

**デザインに含まれているか確認する状態**（抜けていたら実装せずに報告し、Claude Design 側で追加する）
- メッセージの送信中 / 送信済み / 送信失敗 / 削除済み
- 送信失敗時の再送 UI
- 再接続中バナー、同期中バナー
- 未読の区切り線
- 入力中インジケータ
- ルームが 0 件 / メッセージが 0 件のときの表示
- ログイン失敗時のエラー表示（ユーザーの存在有無を明かさない文言）
- ワークスペースの切り替え、ワークスペースの作成
- 招待リンクの作成（使用回数と有効期限の指定）、コードは 1 度だけ表示
- 招待リンクの受け入れ（プレビュー → 参加）、無効 / 期限切れ / 使用上限の表示
- メンバー一覧、ロールの変更、キック、owner の譲渡
- 権限不足で操作できない状態の表示
- public ルームを参加せずに閲覧している状態（「参加して投稿する」導線）
- キックされた / ルームから外されたときの表示
- 添付ファイルのアップロード中 / 失敗 / 画像プレビュー

**DoD**
- [ ] 上記の状態がすべてデザインに存在する（または意図的に不要と判断した）
- [ ] `globals.css` にライト / ダークのトークンが役割ベースの名前で定義されている
- [ ] Tailwind が CSS 変数を参照していて、生の値を持っていない
- [ ] `docs/ui/tokens.md` に各トークンの用途が書かれている
- [ ] CLAUDE.md の「デザイン」節を追記した

---

## Phase 2 — 認証（internal/auth）

**エンドポイント**: register / login / refresh / logout / me / verify-email / password-reset（request, confirm）/ `/.well-known/jwks.json`

**要点**
- Access Token: JWT（EdDSA または RS256）、TTL 15 分。クレームは `sub, sid, jti, iat, exp, iss, aud`。ロールは入れない
- Refresh Token: 32 バイトの不透明文字列。SHA-256 ハッシュだけを保存し、TTL 30 日、使うたびにローテーション
  - `family_id` を `sid` として使う
  - 失効済みのトークンが使われたら、`family_id` が一致する行を 1 回の UPDATE で全部失効させる（`revoked_reason = reuse_detected`）
- Web は Refresh Token を httpOnly Cookie で、ネイティブはボディで受け渡す。分岐は 1 箇所に閉じ込める
- ログイン失敗では、ダミーハッシュで検証して時間差を消す
- ログインと password-reset にレート制限（Redis の固定ウィンドウ、IP + アカウント単位）
- パスワードリセットが完了したら、そのユーザーの全 family を失効させる
- 鍵は環境変数から読む。起動時になければ明確なエラーで落ちる。`make keys` で開発用の鍵を生成する
- Mailer はインターフェースだけ用意し、開発用の実装は slog に出力する
- `internal/platform/authn`: JWT 検証ミドルウェア、context への userID / sid の格納（非公開のキー型）、`auth:revoked` の購読フック
- OAuth は実装しない。`oauth_accounts` テーブルと PKCE を見据えたインターフェースだけ用意する

**DoD**
- [ ] register → login → refresh → me → logout が通る
- [ ] Refresh Token を 2 回使うと、family 全体が失効する
- [ ] 期限切れの Access Token で 401 になる
- [ ] 別の端末でログアウトしても、自分の sid は有効なまま
- [ ] Argon2id、ローテーション、再利用検知のユニットテストがある
- [ ] エンドポイントの統合テストが実物の Postgres で通る

---

## Phase 3a — ワークスペース / ロール / 招待 / ルーム

WebSocket は書かない。

**エンドポイント**
```
POST   /api/v1/workspaces
GET    /api/v1/workspaces                               自分が所属するワークスペース一覧
GET    /api/v1/workspaces/{id}
PATCH  /api/v1/workspaces/{id}                          name / invite_policy
GET    /api/v1/workspaces/{id}/members
PATCH  /api/v1/workspaces/{id}/members/{userID}         ロール変更
DELETE /api/v1/workspaces/{id}/members/{userID}         キック（自分を指定したら退出）
POST   /api/v1/workspaces/{id}/ownership-transfer
POST   /api/v1/workspaces/{id}/invites
GET    /api/v1/workspaces/{id}/invites
DELETE /api/v1/workspaces/{id}/invites/{inviteID}
GET    /api/v1/invites/{code}                           プレビュー（非メンバーでも可）
POST   /api/v1/invites/{code}/accept
POST   /api/v1/workspaces/{id}/rooms                    public / private / dm
GET    /api/v1/workspaces/{id}/rooms                    参加中のルームと、参加可能な public ルーム
GET    /api/v1/rooms/{id}
PATCH  /api/v1/rooms/{id}
POST   /api/v1/rooms/{id}/join                          public のみ
POST   /api/v1/rooms/{id}/members                       private に人を追加
DELETE /api/v1/rooms/{id}/members/{userID}
GET    /api/v1/rooms/{id}/members                       ルームのメンバー一覧（ADR 0011 で追加）
```

**要点**（詳細と、権限表にない操作の判断は ADR 0011）
- authz レイヤを 1 箇所に作る。判定は `canReadRoom` / `canWriteRoom` / `canManage` / `canGrant` / `canCreateInvite` の形
- ロール変更は `canManage(actor, target) && canGrant(actor, newRole)`
- owner の譲渡は 1 トランザクションで行う（旧 owner を admin に降格 → 新 owner を昇格）。対象の行は `SELECT ... FOR UPDATE` でロックする
- owner は譲渡するまで退出できない
- 招待の受け入れ
  - すでにメンバーなら使用回数を消費せずに成功を返す
  - 使用回数の加算は `UPDATE ... WHERE revoked_at IS NULL AND expires_at > now() AND (max_uses IS NULL OR use_count < max_uses) RETURNING`
  - ワークスペースへの参加と `is_default` ルームへの参加は同じトランザクションで行う
- ワークスペースから外れたら、そのワークスペースのすべての `room_members` を削除する
- DM を作成するときは、既存の `dm_key` があればそれを返す
- ルームに参加したら `last_read_seq` を現在の `last_message_seq` で初期化する

**DoD**
- [x] curl だけで ワークスペース作成 → 招待 → 別ユーザーが参加 → ルーム作成 → 参加 が通る
- [x] 権限表のすべてのセルにテストがある（許可と拒否の両方）
- [x] admin が他の admin を降格もキックもできない
- [x] `max_uses = 1` の招待に 50 goroutine が同時に参加しても、成功は 1 件だけ
- [x] owner の譲渡を並行で実行しても、owner が 0 人や 2 人にならない
- [x] 同じ 2 人の DM を並行で作成しても 1 つにしかならない

---

## Phase 3b — メッセージの REST API

**エンドポイント**
```
POST   /api/v1/rooms/{id}/messages     送信
GET    /api/v1/rooms/{id}/messages     履歴（?before_seq= / ?after_seq= / limit 上限 100）
PATCH  /api/v1/rooms/{id}/messages/{messageID}
DELETE /api/v1/rooms/{id}/messages/{messageID}
POST   /api/v1/rooms/{id}/read         既読位置の更新（後退させない）
```

**要点**
- 送信は単一トランザクションで行う
  1. authz（書けるか）
  2. `UPDATE rooms SET last_message_seq = last_message_seq + 1, last_message_at = $now ... RETURNING last_message_seq`
  3. `INSERT messages`
  4. 送信者の `last_read_seq` を進める
- `UNIQUE(room_id, sender_id, client_msg_id)` 違反は、既存のメッセージを 200 で返す（冪等）
  - 重複時に seq を消費しない（欠番を作らない）こと。seq の UPDATE の後に `INSERT ... ON CONFLICT DO NOTHING` を使うと、UPDATE だけがコミットされて欠番になるので使わない。
    「先に client_msg_id で既存を探す → なければ採番して INSERT → 競合で一意制約違反になったらロールバックして既存を返す」を想定。方式は実装前に提案する
    → 送信者の `room_members` の行をロックしてから既存を探す方式に確定（ADR 0012）
- ルーム一覧（`GET /api/v1/workspaces/{id}/rooms`）で、最終メッセージの本文、相対時刻、未読数を N+1 なしで返す
- 削除は論理削除にし、body を空にする
- `after_seq` は再接続の穴埋めに使う経路なので、テストを厚くする

**DoD**
- [x] curl だけで 送信 → 履歴取得 が通る
- [x] 同じ client_msg_id で 2 回送っても、メッセージは 1 件しか増えず、seq も消費されない
- [x] 50 goroutine で同じルームに同時送信しても、seq に欠番も重複もない
- [x] public ルームを非メンバーが読めて、書けない
- [x] 別ルームのメッセージへの返信が DB 制約で拒否される

---

## Phase 3c — 添付ファイル

**エンドポイント**
```
POST   /api/v1/rooms/{id}/attachments          署名付き PUT URL の発行（pending 行を作成）
POST   /api/v1/attachments/{id}/complete       HEAD でサイズと MIME を検証する
GET    /api/v1/attachments/{id}/url            authz の後、署名付き GET URL を発行（短い TTL）
```
メッセージ送信で `attachment_ids` を受け取り、同じトランザクションで `attached` にする（uploader = 送信者、room が一致することを確認する）。

**要点**
- private バケットを使う。公開 URL は作らない
- presigned PUT の署名に `Content-Length` と `Content-Type` を含める（R2 は presigned POST に対応していないため）
- MIME の許可リストとサイズの上限は設定値にする
- 一定時間を過ぎた pending の添付は、オブジェクトと行を削除する（`Clock` を注入した定期ジョブ。複数台で重複して実行されないよう `FOR UPDATE SKIP LOCKED` で取得する）
- メッセージを削除したら、そのメッセージの添付も削除対象にする
- `platform/storage` の S3 API 抽象だけを使う。ローカルは MinIO
- 状態（pending / uploaded / attached / deleted）、受け付ける種類、画像の寸法、掃除ジョブの詳細は ADR 0013

**DoD**
- [x] curl で 発行 → 直接 PUT → complete → メッセージに添付 → GET URL の取得 が通る
- [x] 上限を超えるサイズの PUT がストレージ側で拒否される（署名にサイズを含めるので、申告と違うサイズはすべて拒否される。ADR 0013）
- [x] ルームのメンバーでないユーザーは GET URL を取得できない（public はワークスペースのメンバーなら参加していなくても読めるので取得できる）
- [x] 他人がアップロードした添付を自分のメッセージに付けられない
- [x] 期限切れの pending が掃除される（Clock を進めるテスト）

---

## Phase 4 — WebSocket（単一インスタンス）

Redis Pub/Sub は使わず、インメモリの Hub だけで実装する。意図的に「2 台目を立てると壊れる」状態を作る。

**要点**（詳細は ADR 0014 / 0015、イベントのスキーマは `docs/events.md`）
- `POST /api/v1/ws/ticket`: TTL 30 秒の使い捨てチケット。Redis に SETEX で保存し、接続時に GETDEL で消費する。実装は `platform/authn`
  - 接続は `GET /api/v1/ws?ticket=`。消費時に sid のセッションが有効かも確かめる（`authn.SessionChecker`。実装は auth）
- 切断中の編集・削除も取れるよう、`rooms.last_change_seq` / `messages.change_seq` と `GET /rooms/{id}/messages?after_change_seq=` を追加（ADR 0014）
- 購読の単位はワークスペースとルーム。本人宛てのイベントは購読なしで届く（ADR 0015）
- Hub
  - 1 接続につき読み取り 1 本 + 書き込み 1 本の goroutine。書き込みは 1 本に集約する
  - buffered channel が詰まったら切断する
  - userID と sid から複数の接続を引ける対応表を持つ
- `Delivery` インターフェース（ユースケース層は実装を知らない）
- イベント（`docs/events.md` にスキーマをまとめる）
  - サーバー → クライアント: `message.created` / `message.updated` / `message.deleted` / `member.joined` / `member.left` / `room.updated` / `room.member_removed` / `workspace.updated` / `workspace.member_removed` / `workspace.role_changed` / `presence.changed` / `typing.started` / `ack`
  - クライアント → サーバー: `subscribe` / `unsubscribe` / `typing` / `ping`
  - `docs/ui/` の全状態がイベントで表現できるか確認し、足りなければ実装前に指摘する
    → `room.read`（他端末の既読）を追加、`member.joined` を本人にも送る、presence の初期値は REST（`online`）で返す、に確定（ADR 0015）
- `subscribe` のたびに authz を実行する。権限が変わったら、サーバー側で購読を解除してからイベントを送る
- 30 秒ごとに Ping を送り、60 秒応答がなければ切断する。登録解除は defer で行う
- presence: `presence:{userID}`（TTL 60 秒）、typing: `typing:{roomID}:{userID}`（TTL 5 秒）
- `auth:revoked` を受けたら、該当する sid（または userID）の接続を全部切る
- 5 分ごとに、接続中のセッションと購読を DB で再検証する（ADR 0007 / 0015）

**DoD**
- [x] 2 タブで同じルームを開き、片方の送信が即座に他方へ届く（`internal/httpx/ws_test.go` の `TestWSDeliversMessages`。Web の UI は Phase 6）
- [x] 切断 → 送信 → 再接続 → 差分を取得し、取りこぼしがない（`TestWSReconnectSync`。差分は `after_change_seq` で取り、切断中の編集・削除も含む）（手動でも確認する）
- [x] private ルームから外されたユーザーには、以降のイベントが届かない（`TestWSRemovedFromRoomAndWorkspace`）
- [x] 接続を 100 本張って切る、を繰り返しても goroutine がリークしない（`TestWSNoGoroutineLeak`。`-race` と `runtime.NumGoroutine()`）

---

## Phase 5 — 水平スケール（Redis Pub/Sub）

**要点**
- Caddy をロードバランサとして追加し、`--scale server=2` で「別インスタンスに届かない」ことを先に再現する
- `RedisDelivery`: `room:{roomID}` に publish する。各インスタンスは、自分が接続を持っているルームだけを購読する
- ユーザー宛てのイベント（キック、ロール変更）は `user:{userID}` チャンネルで配信する
- Redis Pub/Sub は at-most-once であり、`after_seq` による差分取得が保険になる。この関係を ADR に明記する
- Redis が落ちたとき: 永続化（Postgres）は成功させ、配信だけ失敗として扱う
- 添付の掃除ジョブが複数台で重複して実行されないことを確認する

**DoD**
- [x] `--scale server=2` で、どちらに接続しても全員にメッセージが届く（`internal/httpx/ws_scale_test.go` の `TestWSDeliversAcrossInstances`。compose の Caddy + 2 台でも手で確認）
- [x] 1 台を `docker compose stop` しても、再接続後に差分を取得して整合性が保たれる（compose で 1 台を止め、1001 で切れた接続が別の 1 台に再接続して `after_change_seq` で切断中のメッセージを取れることを確認。止めている間の送信は Caddy がもう 1 台に送り直す）
- [x] Caddy が WebSocket のアップグレードを正しく通している（上の確認はすべて Caddy 経由）
- [x] 別インスタンスに接続しているユーザーをキックしても、その場で購読が解除される（`TestWSKickAcrossInstances`）

**確定した内容**（ADR 0016 / 0017）
- チャンネルは `room:` / `user:` に加えて `workspace:`（ADR 0015 のワークスペースの購読）。権限が変わったユーザーの `user:` にも流す
- `subscribe` の ack と接続の登録は、Redis が購読を反映するまで待つ（番号付きの PING）
- presence は Redis 7.4 のハッシュ（フィールドはインスタンスの ID、フィールドごとの TTL）で数え、状態の変更と presence.changed の publish を Lua で同時に行う
- Pub/Sub の接続が張り直されたら、そのインスタンスの WebSocket を 1012 で切って同期させる
- Caddy の後ろで IP 単位のレート制限が共有されないよう、`TRUSTED_PROXIES` から X-Forwarded-For を読む（ADR 0017）
- 添付の掃除ジョブが複数台で重複しないことは `TestCleanupAttachmentsConcurrentInstances` で確認

---

## Phase 6 — Next.js クライアント

**6-1 見た目**: presentational コンポーネントだけを作る。`/dev/preview` で `docs/ui/` の全画面・全状態をモックデータで再現する。
**6-2 データ層**: fetch ラッパー（単一フライトの refresh）、WS クライアント（ws-ticket、指数バックオフ + ジッター、`after_seq` による同期、`connected | reconnecting | syncing`）、楽観的更新、seq によるソート、署名付き URL での直接アップロード。
**型**: Go 側のイベント定義から TypeScript の型を生成する（方式は 6-2 で提案する）。

**6-1 で確定した内容**（ADR 0018）
- コンポーネントは表示用の型を props で受け取り、時刻などの文言は整形済み、操作の可否は判定済みで受け取る。整形・判定・seq による並べ替えは 6-2 のデータ層で行う
- アバターの色は ID のハッシュ、書体は next/font、アイコンは lucide-react
- `/dev/preview` の名前はスクリーンショットのパスと同じ。本番のビルドでは 404
- 6-1 で見つかったデザインの抜け（キックの入口、チャンネルの作成、メッセージの編集など）は、同じトークンで描いて `docs/ui/` に足した

**設定画面のための API**（Phase 6 で追加。ADR 0019）
```
GET    /api/v1/auth/sessions              ログイン中のセッションの一覧
DELETE /api/v1/auth/sessions/{sessionID}  1 つ失効させる
DELETE /api/v1/auth/sessions              いま使っているセッション以外をすべて失効させる
PATCH  /api/v1/users/me                   display_name / handle
POST   /api/v1/users/me/avatar           アバター画像の署名付き PUT URL の発行
POST   /api/v1/users/me/avatar/complete  HEAD で検証してプロフィールに反映する
DELETE /api/v1/users/me/avatar           画像を外す
POST   /api/v1/users/avatars             画面に出すユーザーの署名付き GET URL をまとめて取る
```
アバター画像の配布は、chat のレスポンスに URL を載せず、クライアントがまとめて取る（ADR 0020）。

**6-2 で確定した内容**
- ブラウザから Go の API を直接呼び、Go に CORS を足す。Web と API は同じサイトに置く（ADR 0021）
- TypeScript の型は、`internal/httpx` のパッケージ内のテストが Go の型から生成する（`-update` で更新し、CI で差分がないことを確かめる）
- クライアントの状態は、自作のストアと `useSyncExternalStore` で持つ（ライブラリを入れない）
- Access Token はメモリにだけ持ち、refresh は Web Locks でタブをまたいで 1 本ずつにする。ログインしていない人の振り分けはブラウザで行う（ADR 0024）

**本番のページの構築順**
6-2 はデータ層の部品だけでなく、それをつないだ本番のページも作る（6-1 のコンポーネントのモックデータを本物に差し替える）。完了条件はここまで来ないと確かめられない。

1. **ログイン・登録**: fetch ラッパー（タブをまたいで refresh を 1 本にする）、認証状態、ログインしていないときの振り分け、ルートの骨組み ← 完了
   - パスワードの再設定とメールの確認のページ（メールのリンクの受け口） ← 完了
2. **ワークスペースとルームの画面（REST のみ）**: サイドバー、履歴の表示、既読。ログイン後の振り分けと、ワークスペースが 0 件のときの表示（デザインは `chat/workspace/empty-workspaces.png`、コンポーネントは `NoWorkspaces`） ← 完了（ADR 0025）
   - ワークスペースの作成と切り替え、チャンネルの作成、public ルームへの参加、古い履歴の読み込み、メンバーパネルも含めた。入力欄は 4 で出す
3. **リアルタイム**: WS クライアント、再接続と `after_change_seq` による同期、presence、入力中の表示 ← 完了（ADR 0026）
   - キック・ルームから外されたときの表示と、サーバーに届かない画面も含めた。入力中を送るのは入力欄と一緒に 4 で行う
4. **送信**: 楽観的更新、失敗したときの再送、二重投稿の防止 ← 完了（ADR 0027）
   - 入力中を送ること、返信・編集・削除も含めた。送信中のメッセージは端末に保存しない
5. **添付とアバター** ← 完了（ADR 0028）
   - アバターは表示だけ。画像のアップロードと削除は、設定の画面と一緒に 6 で行う
6. **管理画面**: メンバー、招待、設定（3 つの PR に分ける。オーナーと確認）
   - 6-a ワークスペースの管理（設定・メンバー・招待リンク） ← 完了（ADR 0029）
   - 6-b 招待リンクの受け入れ（`/j/{code}`） ← 完了（ADR 0030）
   - 6-c ユーザー設定（プロフィール・アバターの変更・デバイス・外観。表示の密度はデザインがないので出さない） ← 完了（ADR 0031）
   - 6-d 足りなかった入口（DM、チャンネルの設定、メンバーの追加、チャットに戻る）をデザインに足してつなぐ ← 完了（ADR 0032）
   - 6-e チャンネルを自分で退出する入口（6-d で漏れていた）をデザインに足してつなぐ ← 完了（ADR 0034）

2 が終われば、実際にログインしてメッセージを読めるアプリになる。3 と 4 で完了条件を確かめられる。

**DoD**
- [x] `/dev/preview` で全画面・全状態が再現できる（6-1。`app/dev/preview/catalog.test.tsx` がスクリーンショットとの 1 対 1 の対応を検査。デスクトップは headless Chrome、モバイルは幅 390px で並べて確認）
- [x] ネットワークを切断 → 復帰で正しく同期される（compose で Caddy を止め、その間に別のユーザーが server に直接 3 件送る。「サーバーに接続できません」の画面から自動で戻り、3 件が揃う）
- [x] 切断中に送信 → `failed` 表示 → 再送しても二重投稿されない（Caddy を止めた直後に送ると「送信できませんでした」になり、「サーバーに接続できません」の画面を挟んでも残る。復帰後に「再送する」を 2 度押しても DB は 1 件で、seq に欠番もない）
- [x] 送信中にリロードしても二重投稿されない（server を `docker compose pause` して送信中のままリロードする。ADR 0027 のとおり、届いていない送信は消え、自動では送り直さない）
- [x] キックされたときに UI が即座に反映される（別のユーザーが API でキックすると、1 秒以内に「ワークスペースから削除されました」になる）

---

## Phase 6.4 — システムメッセージ

**目的**: 参加・退出・チャンネルの作成・名前の変更を、チャンネルのログとして残す（Slack と同じ見え方）。オーナーの要望（2026-09-19）。

- `messages` に `kind`（`user` / `system`）と `system_type` / `system_data` を足し、人の発言と同じ行として seq を採番する（ADR 0033）
- 未読数はシステムメッセージを数えない。人の発言だけを数えた番号（`user_seq`）を並走させ、引き算のまま O(1) に保つ
- 画面は日付の区切りと同じ中央寄せの 1 行（`chat/timeline/system-messages.png`）

**DoD**
- [x] チャンネルを作る・参加する・退出する・外される・名前を変えると、その行がタイムラインに残る
- [x] システムメッセージでは未読バッジが増えない
- [x] システムメッセージを編集・削除できない
- [x] DM にはシステムメッセージが出ない

---

## Phase 6.5 — スレッド ← 完了（2026-09-19）

**目的**: メッセージへの返信をスレッドにまとめ、チャンネルのタイムラインを流れにくくする。

Phase 6 の後に独立したフェーズとして行う（設計 → API → WebSocket → Web を一通り）。番号を 7 にしないのは、既存の ADR が「Phase 7 以降」で Push 通知や OAuth などを指しているため。

**オーナーと確定した内容**（2026-09-17）
- スレッドの返信は、チャンネルのタイムラインに出さない
- **スレッドの返信は、チャンネルの未読数に数えない。** スレッドは別に未読を持つ（参加しているスレッドの未読）
- 「チャンネルにも投稿する」（スレッドの返信をチャンネルにも流す）は最初は作らない。あとから足せる形にしておく
- **Phase 6 の引用付きの返信（`reply_to_id`、`chat/composer-reply.png`）は、スレッドに置き換える。** メッセージの「返信」はスレッドを開く

**確定した内容**（ADR 0036、2026-09-19 にオーナーと確認）
- 順序と同期は **ルームの `seq` / `change_seq` を共有する**。スレッドごとの番号にはしない（同期がルームごとに 1 本で済み、「チャンネルにも投稿する」をフラグ 1 つで足せる）。チャンネルの seq は飛び飛びになる
- `messages.thread_root_id`（複合 FK）と、スレッドの中の番号 `thread_seq`。親は `last_thread_seq`（未読用のカウンタ）・`thread_reply_count`（表示用）・`thread_last_reply_at` を持つ
- チャンネルの未読は `user_seq` のまま（返信では進めない）。スレッドの未読は `last_thread_seq - last_read_thread_seq`
- 参加（`thread_members`）は親の投稿者と返信した人。`room_members` への FK で、ルームを抜けたら消える。メンションを足したら、メンションされた人の行を同じテーブルに足す
- `reply_to_id` は消す。既存の返信はチャンネルの普通の投稿として残る
- 返信はルームの購読者に `message.created` で届け、親の返信数は `message.updated` で届ける。`thread.read` / `thread.followed` を本人に届ける
- 画面は既存のトークンで描いて `docs/ui/` に足してから実装する（ADR 0032 と同じ撮り方）

**構築順**（PR を分ける）
1. 設計（ADR 0036、ERD） ← 完了
2. デザイン: スレッドのパネル、「N 件の返信」、サイドバーの「スレッド」と一覧、モバイル、削除された親、返信 0 件。`/dev/preview` に描いて `docs/ui/` に足し、オーナーに見てもらう ← 完了（`docs/ui/README.md` の「Phase 6.5 で足した画面」）
3. DB と REST: マイグレーション（`reply_to_id` の削除を含む）、返信の送信・編集・削除、スレッドの履歴・既読・一覧 ← 完了（ADR 0036 の追記。Web の引用付きの返信もここで取り除いた）
4. WebSocket: `message.updated`（親の返信数）、`thread.read` / `thread.followed`、`typing` の `thread_root_id`。`docs/events.md` の更新 ← 完了（ADR 0036 の追記）
5. Web: スレッドのパネル、スレッドの未読、引用付きの返信の撤去 ← 完了（ADR 0037。引用付きの返信の撤去は構築順 3 で済ませた）

**追加で決めたこと**（2026-09-19、オーナーの要望）
- 削除したメッセージを画面から消す（Slack と同じ。返信の残るスレッドの親だけ跡を残し、サイドバーはひとつ前のメッセージ。ADR 0038）

**DoD**
- [x] メッセージからスレッドを開いて返信でき、チャンネルのタイムラインには出ない（`workspace-screen.test.tsx` の threads。オーナーが compose の実物で確認済み、2026-09-19）
- [x] 親メッセージに返信数と最終返信が出て、リアルタイムに更新される（返信の削除で返信数が減る）（`TestThreadEvents`、`workspace-screen.test.tsx`）
- [x] スレッドの返信でチャンネルの未読数が増えず、サイドバーの並びも動かない。参加しているスレッドの未読が分かる（`TestSendThreadReply`、`store.test.ts` / `workspace-screen.test.tsx` の threads）
- [x] 切断中に届いたスレッドの返信も、再接続の同期（`after_change_seq`）で揃う（WebSocket の切断 → 返信・削除 → 再接続の差分取得を実物の Postgres / Redis で通す `internal/httpx/ws_test.go` の `TestWSReconnectSyncThread`、再接続でパネルと一覧を取り直す `realtime.test.ts`。オーナーがブラウザと compose で確認済み：DevTools で片方のタブだけをオフラインにして返信を送り、復帰後にパネルと未読が揃う、2026-09-19）
- [x] 同じ client_msg_id の再送でスレッドに二重投稿されない（`internal/chat/thread_test.go` の `TestSendThreadReplyIdempotent`）
- [x] 50 goroutine で同じスレッドに同時に返信しても、`thread_seq` に欠番も重複もなく、親の編集と並行してもデッドロックしない（`TestSendThreadReplyConcurrent`、`TestEditAndReplyConcurrentNoDeadlock`、`TestDeleteThreadReplyConcurrent`）
- [x] ルームから外れると、そのルームのスレッドは参加中の一覧と未読から消える（`TestThreadFollowGoneWhenLeavingRoom`、`db/schema_test.go` の `TestThreadMembersConstraints`）

---

## Phase 6.6〜6.16 — Slack と同じ使い心地にする

**目的**: Slack と比べて足りない機能を足す。オーナーの要望（2026-09-19）。「実装できるものは全部入れる」。

Phase 6.4 / 6.5 と同じく、1 つの機能を 1 つのフェーズにして、設計 → API → WebSocket → Web を一通り行う。番号を 7 にしないのは、Phase 6.5 と同じ理由（既存の ADR が「Phase 7 以降」で Push 通知や OAuth などを指しているため）。

**全フェーズに共通すること**
- フェーズの最初に ADR を書き、オーナーの確認を取ってから実装する。下の「ADR で決めること」はその論点。
- 画面は既存のトークンで `/dev/preview` に描いて `docs/ui/` に足し、オーナーに見てもらってから実装する（ADR 0032 と同じ撮り方）。新しいトークンが要るときは、そこで確認する。
  **Phase 6.7.6 で `/dev/preview` は Storybook に移る**（ADR 0047）。移行のあとは「story に描いて `docs/ui/` に足す」と読み替える。
- 変更はすべて、再接続の同期（`after_change_seq`）で取り戻せるようにする（絶対ルール 4）。WebSocket でしか届かない状態を作らない。
- 閲覧できるかどうかの判定は authz に集める（絶対ルール 9）。別のルームのメッセージを見せる機能（リンクのカード・ピン留め・保存・検索）は、見る人ごとに判定する。

**並び順の理由**: 後ろのフェーズは前のフェーズの上に乗る。
- 絵文字のピッカー（6.7）は、カスタムステータス（6.8）でも使う。
- 離席とカスタムステータス（6.8）は、プロフィールのカード（6.9）に出す。
- 本文の書式（6.10）は、URL・パーマリンク・メンションを本文から見つける仕組みも兼ねる。先に作っておくと、6.11 と 6.13 で解釈を作り直さずに済む。
- 指定したメッセージへ飛ぶ仕組み（6.11）は、ピン留め・保存（6.12）と検索（6.16）の結果を押したときにも使う。
- プロフィールのカード（6.9）は、メンションの `@名前` を押したときにも開く。
- `/dev/preview` を Storybook に移す（6.7.6）のは機能ではなく道具の入れ替え。以後のフェーズの「デザインを描いて見てもらう」がこの上で回るので、
  画面の少ない今のうちに済ませる。オーナーと決めた着手の順（6.7.5 のあと）もここ。
- 添付ファイルの拡大表示と削除（6.7.5）は、あとのどのフェーズにも乗らない。オーナーの要望（2026-09-20）が先に来たので、6.8 より先に入れた。番号を振り直さないのは、既存の ADR が「6.10 の仕組みに乗せる」のようにフェーズ番号で互いを指しているため（Phase 1.5 と同じ入れ方）。

```
Phase 6.6   チャンネルにも投稿する
Phase 6.7   絵文字のリアクション
Phase 6.7.5 添付ファイルの拡大表示と削除
Phase 6.7.6 /dev/preview を Storybook に移す（機能ではなく道具）
Phase 6.8   離席とカスタムステータス
Phase 6.9   プロフィールのカード
Phase 6.10  本文の書式
Phase 6.10.5 未検証の email ではチャットを使えないようにする
Phase 6.11  メッセージへのリンク（コピー・飛ぶ・カード・新着の線）
Phase 6.12  ピン留めと保存
Phase 6.13  メンション
Phase 6.14  ミュートとブラウザ通知（6.14a 設定 / 6.14c スレッドのミュート / 6.14b 通知）
Phase 6.14.5 サイドバーのメニューとアクティビティ
Phase 6.15  チャンネルのアーカイブと削除
Phase 6.16  検索
```

---

## Phase 6.6 — チャンネルにも投稿する

**目的**: スレッドの返信を、チャンネルのタイムラインにも流せるようにする（Slack の「チャンネルにも投稿する」）。ADR 0036 で「あとから足せる形にしておく」とした機能。

**オーナーと確定した内容**（2026-09-19）
- スレッドのパネルの入力欄にチェックボックスを置く
- ルームの `seq` はもともと共有しているので（ADR 0036）、返信の行にフラグを 1 つ足してチャンネルにも出す

**ADR で決めること** ← 完了（ADR 0039。オーナーの確認: 2026-09-19）
- チャンネルに流した返信を、チャンネルの未読（`user_seq`）とサイドバーの並びに数えるか → 数える
- フラグを送信後に変えられるか → 変えられない
- 親や返信が削除されたときのチャンネル側の見え方（ADR 0038 との整合） → 返信の削除で両方から消え、親の削除では残る
- チャンネル側の見え方 → 「スレッドに返信しました」のラベルだけ。親の抜粋は出さない

**DoD**
- [x] 「チャンネルにも投稿する」を付けた返信が、スレッドとチャンネルの両方に出る。付けない返信はチャンネルに出ない（`internal/chat/thread_broadcast_test.go` の `TestSendThreadReplyAlsoInChannel`、`internal/httpx/thread_test.go` の `TestThreadReplyAlsoInChannel`（返信でなければ 422）、`views.test.ts` の「チャンネルにも投稿する（ADR 0039）」、`workspace-screen.test.tsx` の同名の節）
- [x] 切断中に流された返信も、再接続の同期でチャンネルとスレッドの両方に揃う（差分（`after_change_seq`）は返信もそのまま返すので、振り分けはクライアント側。`store.test.ts` の `restores a broadcast reply sent while disconnected in both the channel and the thread` で、同期した 1 行がチャンネルとスレッドの両方に入ることを確かめている。チャンネルの `after_seq` の取得に載ることは `TestThreadReplyAlsoInChannel`）
- [x] 未読とサイドバーの並びが、ADR で決めたとおりに動く（`TestSendThreadReplyAlsoInChannel`（`last_user_seq` と送信者の既読位置）、`TestBroadcastReplyStaysWhenRootIsDeleted`（親を消しても残り、サイドバーの 1 行になる）、`messages.test.ts` / `store.test.ts`）

実装は ADR 0039 の追記のとおり（設計 → デザイン → DB と API → Web）。オーナーによる実物での確認は未実施。

---

## Phase 6.7 — 絵文字のリアクション

**目的**: メッセージに絵文字でリアクションできるようにする。

**オーナーと確定した内容**（2026-09-19）
- Unicode の絵文字だけ。カスタム絵文字は作らない（画像の保存と管理画面が要るため）

**ADR で決めること** ← 完了（ADR 0044。オーナーの確認: 2026-09-20）
- テーブル → `message_reactions(message_id, user_id, emoji)` を主キーにして、二重に付けられないことと付け外しの冪等性を DB で保証する。件数の列は持たない（ADR 0041 と同じ理由）
- 同期 → 付け外しでメッセージの `change_seq` を 1 つ進め、集計を `reactions` としてメッセージの形に含める。`message.updated` と差分（`after_change_seq`）にそのまま乗り、経路を増やさない
- 1 つのメッセージに付けられる種類の上限 → 20 種類（超えたら 422）
- 絵文字の文字列の検証 → 書記素クラスタ 1 つ・64 バイト以内・先頭が Emoji のコードポイント。正規化はしない
- 絵文字のピッカー → `emoji-mart` を入れる（Slack と見た目が近いため）。React ラッパーは peer に React 19 がないので使わず、本体だけを `div` に挿す。データは動的 import
- 誰が付けたかの表示 → レスポンスに先頭 8 人の `user_id` を載せ、「A、B 他 N 人」と出す

**構築順**（PR を分ける）
1. 設計（ADR 0044、ERD） ← 完了
2. デザイン: リアクションの行・ピッカー・ホバーの名前・モバイル。`/dev/preview` に描いて `docs/ui/` に足し、オーナーに見てもらう ← 完了（`docs/ui/README.md` の「Phase 6.7 で足した画面」）
   モバイルのピッカーは、はみ出して切れたので下から出るシートにした（ADR 0044 決定 7 の追記）
3. DB と REST: マイグレーション、`PUT` / `DELETE` の API、メッセージのレスポンスの `reactions` ← 完了
   `me` は REST だけに載せ、`message.updated` では落とす（ADR 0044 決定 3 の追記）
4. WebSocket と Web: `message.updated` への相乗り、楽観的更新、ピッカーのつなぎ込み ← 完了

**DoD**
- [x] 付け外しが他の人の画面にリアルタイムに反映される（サーバーは `internal/httpx/ws_test.go` の `TestWSDeliversReactions`（`message.updated` で届き、`me` だけが落ちる）。画面側は `workspace-screen.test.tsx` の「絵文字のリアクション（ADR 0044）」の「届いた message.updated で数が増え…」。押したときに手元で先に反映されるのは `store.test.ts` の `toggleReaction`）
- [x] 切断中の付け外しも、再接続の同期で揃う（付け外しで `change_seq` が 1 つ進むので、差分（`after_change_seq`）にそのまま乗る。`TestAddAndRemoveReaction` の「change_seq が 1 つ進み、seq は進まない」と `TestWSDeliversReactions`。差分を取り直す経路そのものは ADR 0014 のまま変えていない）
- [x] 50 goroutine で同じ絵文字を同時に付け外ししても、数がずれない（`internal/chat/reaction_test.go` の `TestConcurrentReactionsKeepCount`。数はカウンタではなく行を数えた結果なので、取り合いが起きない）
- [x] 削除されたメッセージ・システムメッセージにはリアクションできない（`TestReactionAuthorization` の 2 件と `TestDeletingMessageHidesItsReactions`（削除で跡も残さない。ADR 0038）。HTTP では `internal/httpx/reaction_test.go`）

オーナーによる実物での確認は未実施。

**意図的に残したもの**
- 誰が付けたかを**全員**見せる画面は作っていない（ホバーの「A、B 他 N 人」まで。ADR 0044 の「検討した代替案」）
- ルームを抜けた人のリアクションは DB が消すが、そのとき `change_seq` は進まないので、
  ほかの人の画面ではそのメッセージを読み直すまで古い数が残る（ADR 0044 の「結果」で許容した）

---

## Phase 6.7.5 — 添付ファイルの拡大表示と削除

**目的**: 画像の添付を押したら拡大して見られるようにし、メッセージを消さずに添付ファイルだけを削除できるようにする。

オーナーの要望（2026-09-20、Phase 6.7 のマージ後）。ロードマップにも ADR にもなかった 2 件を 1 つのフェーズにまとめる。
画面が隣り合う（拡大表示の中に削除の導線を置ける）ため。**6.7 の一部ではなく独立したフェーズ**で、番号だけ小数にしてある（上の「並び順の理由」）。

同じ日に挙がった「本文の URL をリンクにする」は、Phase 6.10 の DoD にすでにあるのでここでは扱わない。

**オーナーと確定した内容**（2026-09-20）
- 画像を押したら拡大表示。複数あればスライドのように送れる
- メッセージではなくファイルだけを削除できる。消せる人にだけメニューを出す

**ADR で決めること** ← 完了（ADR 0045。オーナーの確認: 2026-09-20）
- スライドの範囲 → **そのメッセージの添付の画像だけ**（ルーム全体の画像はまとめない。ページングと署名付き URL のまとめ取りが要り、ADR 0028 の方針も見直しになる）
- 削除できる人 → **`authz.CanDeleteMessage` と同じ規則**（送信者本人か、送信者を管理できる admin 以上。ADR 0012）。専用の判定を足さない
- 実体を消す時期 → `status = 'deleted'` にするだけ。既存の掃除ジョブが 24 時間後に消す（ADR 0013。新しいジョブもテーブルも足さない）
- 同期 → 削除でメッセージの `change_seq` を 1 つ進め、`message.updated` に乗せる（ADR 0044 と同じ。`seq` / `user_seq` は進めない）
- 添付が 0 件になり本文も空になったメッセージ → **メッセージごと削除**（ADR 0038 の「跡を残さない」にそろえる）。確認のダイアログで先に伝える
- 閉じ方・キーボードでの送り・ダウンロードの導線 → 拡大表示の中にまとめる（`Esc` / 背景 / ×、`←` `→`、ダウンロードは既存の GET URL の仕組み）

**構築順**（PR を分ける）
1. 設計（ADR 0045、ロードマップ） ← 完了
2. デザイン: 拡大表示（1 枚 / 複数 / モバイル）、削除のメニューと確認ダイアログ。`/dev/preview` に描いて `docs/ui/` に足し、オーナーに見てもらう ← 完了（`docs/ui/README.md` の「Phase 6.7.5 で足した画面」）
   md 以上は全画面にせず大きなダイアログにした。1 つのメッセージの画像が複数あるときは横に並べて折り返す（ADR 0045 決定 3 の追記）
3. API: `DELETE /rooms/{roomID}/messages/{messageID}/attachments/{attachmentID}`、`change_seq` の採番、本文も空なら論理削除 ← 完了
4. Web: 拡大表示のつなぎ込み、削除の導線、`messageActions` の判定 ← 完了
   判定は `messageActions` の `canDelete` をそのまま使った（規則が同じなので新しい項目を足さない。ADR 0045 決定 9 の追記）

**DoD**
- [x] 画像を押すと拡大表示が開き、同じメッセージの画像を矢印とキーボードで送れる。1 枚なら送る導線を出さない（`image-viewer.test.tsx`、`workspace-screen.test.tsx` の「画像を押すと拡大表示が開き…」）
- [x] 拡大表示から閉じるとフォーカスが元の画像に戻り、ダウンロードもそこから行える（同上。キーは画面ぜんぶで受ける。端まで送ると矢印が押せなくなってフォーカスが外れるため）
- [x] 添付だけを削除すると、他の人の画面からもリアルタイムに消え、切断中の削除も再接続の同期で揃う（`store.test.ts` の `message.updated` と `after_change_seq` の 2 件。配信は `TestDeleteMessageAttachment`）
- [x] 消せない人（他人のメッセージ・下位でない相手）には導線が出ず、API も 403（`TestDeleteMessageAttachmentPermission`、`TestDeleteMessageAttachmentAPI`、`workspace-screen.test.tsx` の「消せない人には…」）
- [x] 最後の添付を消して本文も空なら、メッセージごと消える。本文が残っていればメッセージは残る（`TestDeleteLastAttachmentDeletesMessage`）
- [x] 同じ添付を並行して消しても、`change_seq` が 2 回進まない（冪等。`TestDeleteMessageAttachmentConcurrent`）
- [x] 削除した添付の実体が、掃除ジョブでストレージから消える（`TestDeleteMessageAttachment` で status = deleted と実体が残ることを、`TestCleanupAttachments` で deleted の実体が消えることを確かめている）

オーナーによる実物での確認は未実施。

---

## Phase 6.7.6 — `/dev/preview` を Storybook に移す

**目的**: `docs/ui/screenshots/` の PNG と対になる「実装での再現」を、自前の `/dev/preview` から Storybook に移す。
機能を足すフェーズではなく、以後のフェーズの「デザインを描いてオーナーに見てもらう」が回る道具を入れ替える。

オーナーと決めた（2026-09-20）。着手は Phase 6.7.5 のあと。`/dev/preview` は**同じ PR で消す**（二重管理を残さない）。
静的出力を `ui.<独自ドメイン>` に配ることは ADR 0046 の決定 2・4 に入れてある。

**ADR で決めること** ← 完了（ADR 0047）
- 入れるもの → `@storybook/nextjs-vite`（Storybook 10）。`@storybook/addon-vitest` は入れない（peer が `vitest: ^3 || ^4` で web の 5 と合わない）
- PNG との対応 → **story id をそのまま PNG のパスにする**（`chat-attachment--image-viewer` ↔ `chat/attachment/image-viewer.png`）。対応表を持たない
- dark / mobile → story の `parameters` に持たせ、decorator が `<html data-theme>` に当てる。命名の規則は検査としてだけ残す
- 足したフェーズの絞り込み → tag（`since:6.7`）。サイドバーの絞り込みを使い、`catalog-browser.tsx` は消す
- 撮影 → `/index.json` と `iframe.html?id=` に向ける。大きさと出どころ（app / design）を story に持たせ、`<html data-shot-*>` 経由で撮影ツールが読む
- 検査 → portable stories（`composeStories`）でいまの vitest + jsdom に残す

**構築順**（PR を分ける）
1. 設計（ADR 0047、ロードマップ） ← 完了（#80）
2. 移行: Storybook を入れ、story を足し、`/dev/preview` と `catalog*.tsx` を消し、`tools/shoot-ui.mjs` と `docs/` の案内を直す（1 つの PR） ← 完了
3. 部品のカタログ: `components/**/*.stories.tsx` を足す（オーナーの要望、2026-09-21。ADR 0047 決定 12 の追記） ← 完了
4. 画面のディレクトリ分け: `docs/ui/screenshots/` と story を話題ごとのサブディレクトリに分ける（オーナーの要望、2026-09-21。ADR 0047 決定 2 の追記） ← 完了

**DoD**
- [x] `npm run storybook` で 134 画面が出て、名前での検索とフェーズ（`since:`）の絞り込みができる
- [x] `web/app/dev/preview/` が消えている（`catalog.ts` / `screens.tsx` / `catalog-browser.tsx` と、それぞれのテストを含む）。`HIBARI_SCREENSHOTS` の細工も消えている
- [x] PNG と story が 1 対 1、`-dark` / `mobile-` の命名が parameters と合っている、すべての story が空でなく描けることを vitest が検査する（`web/stories/stories.test.tsx`）
- [x] `make web-shots`（引数なし）で `source: "app"` の PNG（51 枚）を全部撮り直せる。同じ story を 2 回撮れば同じ PNG になる
      （撮り直しで 44 枚に差が出た。内訳は下の「撮り直しで出た差」。すべて**古かった PNG が直った**もので、オーナーの確認を取ってから入れる）
- [x] `npm run build-storybook` が CI（`.github/workflows/web.yml`）で通る
- [x] `docs/ui/README.md` と `docs/roadmap.md` の `/dev/preview` の案内が Storybook に直っている
- [x] 部品のカタログがある（`components/ui/` の 10 個と、状態の軸がある 6 個）。controls で props を変えられ、`autodocs` で props の表が出る
- [x] 画面と部品を `screenshot` の tag で見分けていて、部品は撮影の対象にならない。検査は glob で集めるので、story のファイルを足せば自動で入る
- [x] 画面が話題ごとのディレクトリに分かれている（`chat` の 79 枚が 10 個のサブディレクトリに）。PNG のパス・story の id・story のファイルの置き場所が同じ形で対応する

**撮り直しで出た差**（51 枚のうち 42 枚。中身は全部確かめてある）

| 何 | 枚数 | なぜ |
|---|---|---|
| 中身が古かった | 14 | 未読のチャンネルにバッジを出さなくした変更（ADR 0043）と、管理画面の「チャットに戻る」（Phase 6-2）が写っていなかった。`docs/ui/README.md` の「撮り直しが要るもの」に挙がっていた分 |
| メンションの 7 枚 | 7 | 上に加えて、Linux の Chromium で撮ってあった（文字のラスタライズが違う）。オーナーの手元の macOS の Chrome で撮り直した |
| Next.js の開発インジケータ | 4 | `HIBARI_SCREENSHOTS=1` を付けずに撮ってあり、左下に「N」のバッジが写っていた。Storybook には出ない |
| 動きと、数 px のスクロール位置 | 17 | 入力中の「…」が動いている最中のどこかで写っていた。いまは読み込みの前に動きを止め、画像と書体を待ってから撮る |

同じ story を 2 回撮れば同じ PNG になることを、全 51 枚で 2 回通して確かめてある（md5 が一致）。
Claude Design で描いた 83 枚（`source: "design"`）は撮り直しの対象にしていない（実装から撮ったものではないため）。

---

## Phase 6.8 — 離席とカスタムステータス

**目的**: presence に離席を足し、Slack と同じカスタムステータス（絵文字と文言）を設定できるようにする。

**CLAUDE.md の変更を伴う。** これまで「presence はオンラインのドットだけ。離席や最終オンライン時刻は出さない」としていた（`docs/ui/README.md` の「作らないもの」にもある）。オーナーの要望（2026-09-19）で離席を足す。このフェーズの ADR と一緒に、CLAUDE.md（ルール 5 と「デザイン」）、`docs/ui/README.md`、`docs/events.md` を直す。最終オンライン時刻は引き続き出さない。

**オーナーと確定した内容**（2026-09-19）
- 状態は 3 つ: オンライン（今の緑のドット）/ 離席（**色なしのアウトライン**）/ オフライン（ドットなし）
- **画面を見ていないとき（別のタブやウィンドウを見ているとき）は自動で離席にする。** 画面を見ていても、操作がないまま一定時間（10 分など）たったら離席にする
- 複数のタブや端末があるときは、どこか 1 つで画面を見ていればオンライン
- **本人が自分で離席にしたら固定する**（自動ではオンラインに戻らない。本人が戻すまで）。固定した離席は本人の設定として DB に持つ（再起動や Redis のデータが消えても残る）。自動で変わる部分は今までどおり Redis の TTL だけで持つ。ルール 5 は「自動で変わる presence / typing は Redis、本人が選んだ設定は DB」と書き直す
- カスタムステータス: 絵文字 + 文言 + 消える時刻。プロフィールのカード（6.9）、メッセージの名前の横、メンバーパネルに出す。本人の設定なので DB に持ち、消える時刻は `Clock` で判定する

**ADR で決めること** ← 完了（ADR 0049。オーナーの確認: 2026-09-21）
- Redis の持ち方 → インスタンスごとのフィールドの値を「そのインスタンスで画面を見ている接続の数」にする。判定と publish は今と同じ 1 つの Lua スクリプト（ADR 0016 の形を保つ）
- クライアントが送るイベント → `activity`（`active` の真偽値）を**変わったときだけ**送る。`visibilitychange` / `focus` / 10 分操作なし。接続は「見ていない」から始め、つないだ直後に 1 回送る
- `presence.changed` の形 → `online` を捨てて `presence`（`active` / `idle` / `offline`）に**置き換える**。REST の `online` も同じ
- 手動の離席とカスタムステータス → **自動（Redis）と本人の設定（DB）を分けたまま配り、3 つの状態に合わせるのは読む側**。`member.status_changed` を足し、本人のほかのタブにも配る。再接続ではワークスペースのメンバー一覧を取り直す
- 期限切れ → 読むときに `Clock` で落とす。掃除のジョブもイベントも作らない（クライアントは `expires_at` のタイマーで消す）
- 文言の上限 → 100 文字（Slack と同じ）。絵文字は 6.7 の検証（`internal/chat/emoji`）とピッカーをそのまま使う
- 通知（6.14）との関係 → 離席でも通知は止めない（止めるのは「おやすみモード」の役目で、範囲外）
- アウトラインのドット → 既存のトークンで描く（`border-text-muted` の輪と `bg-surface` の中身）。新しいトークンは足さない
- カスタムステータスの単位 → **ワークスペースごと**（Slack と同じ。`workspace_members` に 3 列足す）。手動の離席はユーザーごと（`user_presence_settings`）

**構築順**（PR を分ける）
1. 設計（ADR 0049、ERD、CLAUDE.md ルール 5 と「デザイン」、`docs/events.md`、`docs/ui/README.md`）
2. デザイン: 離席のドット、ステータスの設定ダイアログ、名前の横とメンバーパネルの出方、アカウントメニュー、モバイル。story に描いて `docs/ui/` に足し、オーナーに見てもらう ← 完了（`docs/ui/README.md` の「Phase 6.8 で足した画面」）
   絵文字のピッカーは、ダイアログの中に流し込むと画面からはみ出したので、リアクションと同じ「浮かせる / 下から出す」形にした（ADR 0049 決定 10 の追記）
   期限の文言と選択肢を Slack に合わせ、「日時を選択」と自前のカレンダー（`components/ui/calendar.tsx`）を足した（オーナーの指摘、2026-09-21）
3. DB と REST: マイグレーション、`PUT /users/me/presence`、`PUT` / `DELETE /workspaces/{id}/me/status`、メンバーのレスポンスの `presence` / `away` / `status` ← 完了
   期限切れを落とすのは SQL ではなく Go の `statusOf` 1 箇所（sqlc が CASE 式の NULL 可能性を推せないため。ADR 0049 決定 6 の追記）
   `away` と `status` を載せるのはメンバー一覧だけ。DM の相手とメッセージの送信者の分は、クライアントが一覧から引く（決定 7 の追記）
4. WebSocket と Web: `activity`、Lua スクリプトの作り直し、`member.status_changed`、Web のつなぎ込み（10 分のタイマー、再接続の同期、楽観的更新） ← 完了

**DoD**
- [x] 別のタブを見る・ウィンドウを切り替えると離席になり、戻るとオンラインになる。ほかの人の画面にもリアルタイムに反映される
      （`activity.test.ts` の「タブを離れると false、戻ると true を知らせる」、`internal/httpx/presence_test.go` の `TestWSActivityAndStatus`）
- [x] 操作がないまま一定時間たつと離席になる（`activity.test.ts` の「操作がないまま 10 分たつと離席にする」。偽のタイマーで確かめている）
- [x] 複数のタブや端末のうち 1 つでも見ていればオンライン。複数のインスタンスにまたがる接続でも正しい
      （`internal/chat/presence/presence_test.go` の `TestSyncAcrossInstances` と `TestConcurrentTransitionsKeepEventOrder`、`hub_test.go` の `TestPresence*`）
- [x] 自分で離席にすると、画面を見ても操作してもオンラインに戻らない。再ログインや別の端末でも離席のまま
      （手動の離席は Postgres の `user_presence_settings`。合わせるのは読む側なので、自動の状態が active でも away が勝つ。`lib/presence.test.ts` と `TestSetManualAway`）
- [x] カスタムステータスを設定・消去でき、期限が来たら出なくなる（`TestSetAndClearStatus` の「期限が過ぎたら出なくなる」で `Clock` を進めている）
- [x] カスタムステータスはワークスペースごとに別（`TestSetAndClearStatus` の「ワークスペースごとに別」、`store.test.ts` の「別のワークスペースには away だけを当てる」）
- [x] 手動の離席とカスタムステータスの変更が、本人のほかのタブと同じワークスペースのメンバーに届く。切断中の変更も、再接続の同期で揃う
      （`TestWSActivityAndStatus` の「本人のほかのタブにも届く」。再接続では、ワークスペースのメンバー一覧を取り直して揃える。ADR 0049 決定 9）

オーナーによる実物での確認は未実施。

---

## Phase 6.9 — プロフィールのカード

**目的**: ユーザーのアイコンか名前を押すと、そのユーザーのプロフィールが見られるようにする（Slack と同じ）。

**オーナーと確定した内容**（2026-09-19）
- 開く場所はアイコンと名前の両方（メッセージ、スレッド、メンバーパネル。6.13 のメンションの `@名前` も）
- 表示するもの: アバター、表示名、`@handle`、メールアドレス、ワークスペースのロール、オンラインのドット（presence はドットだけ。CLAUDE.md「デザイン」）
- **メールアドレスは同じワークスペースのメンバー全員に見せる**（招待されて入っている時点で問題ない、というオーナーの判断）。メンバーでなくなれば返さない
- 主ボタンは「DM を送る」（既存の DM があれば開き、なければ作る）。3 点メニューに「ハンドルをコピー」「メールアドレスをコピー」、操作できる相手のときだけ「ロールの変更」「ワークスペースから外す」
- 自分のカードでは「DM を送る」の代わりに「プロフィールを編集」（設定の画面へ）

**ADR で決めること** ← 完了（ADR 0050。オーナーの確認: 2026-09-21）
- chat の API が他人の email を返すのはこれが初めてになる。どの API で返すか → **1 人分の `GET /workspaces/{id}/members/{userID}` だけが返す**。
  一覧・`UserProfile`・イベントには email を足さない。カードは一覧の値ですぐに開き、email の行だけ応答を待つ
- 未検証の email を出すか → **出さない**（`email: null`）。未検証のままチャットを使えること自体は、別の ADR で扱う（ADR 0050 の末尾）
- 管理の入口を出すかどうか → **ADR 0029 の写し（`toMemberRowView` の `manage`）をそのまま使う**。新しく書き写さず、API に判定結果も載せない
- 出し方 → **md 以上はホバーでカード（要約と「DM を送る」）、押すと右のパネル（`?p=`。幅はスレッドと共有）。モバイルは押すと全画面のパネル**
  （デザインを見たオーナーの指摘で、ポップオーバー 1 つから変えた。ADR 0050 決定 6 の追記）
- 一覧にいない人（外された人の過去のメッセージ）→ **名前・`@handle`・アバターだけの縮めたカード**を出す

**構築順**（PR を分ける）
1. 設計（ADR 0050） ← このフェーズの最初の PR
2. デザイン: ホバーのカード、右のパネル（他人・自分・管理できる相手・email の読み込み中と未検証・外された人・メンバーから開いた）、3 点メニュー、モバイルの全画面。story に描いて `docs/ui/` に足し、オーナーに見てもらう ← 完了（`docs/ui/README.md` の「Phase 6.9 で足した画面」）
3. API: `GET /workspaces/{id}/members/{userID}`、`authz.CanViewMemberProfile`、TypeScript の型 ← 完了
   email を読むのは専用のクエリ（`GetWorkspaceMemberProfile`）だけ。検証済みかで落とすのは Go の側（期限切れのステータスと同じ理由）
4. Web: ホバーのカードとパネル（`?p=`）のつなぎ込み、「DM を送る」、コピー、ロールの変更とキック ← 完了
   email はパネルの中だけで持ち、ストアに入れない（`store.getMemberEmail`）。どこから開いたか（メンバーから・メッセージの送信者）は URL に持たない

**DoD**
- [x] メッセージ・スレッドのアイコンと名前に乗せるとカード、押すとパネルが開く。メンバーパネルの行からもパネルが開く
      （`workspace-screen.test.tsx` の「プロフィール（ADR 0050）」、`message-item.test.tsx`、`use-hover-intent.test.ts`）
- [x] モバイルでは押すと全画面のパネルが開き、ブラウザの「戻る」で閉じる（開くのは `router.push` で `?p=` を足す。スレッドの `?t=` と同じ）
- [x] 別のワークスペースのユーザーや、外されたユーザーの email は返らない（API のテスト）
      （`internal/chat/member_test.go` の `TestGetMemberProfile`、`internal/httpx/member_profile_test.go` の `TestMemberProfile`）
- [x] 未検証の email は返らない（API のテスト。同上）
- [x] 外された人の過去のメッセージからは、名前と handle だけのカードとパネルが開く（画面のテストの「no longer in the workspace」。API は呼ばない）
- [x] 管理の入口は、操作できる相手のときだけ出る（`workspace-views.test.ts` の `toProfileView`、画面のテストの「changes the role」「hides the management entries」）
- [x] 「DM を送る」を並行して押しても DM は 1 つ（サーバーは `dm_key` と `TestCreateDMConcurrent`、画面は 2 回押しても POST が 1 回のテスト）


API は開発環境の実物で確認した（未検証なら `email: null`、検証すると email、外された人は 404）。画面はオーナーによる実物での確認が未実施。

---

## Phase 6.10 — 本文の書式

**目的**: 太字・斜体・取り消し線・インラインコード・コードブロック・引用・リストと、URL の自動リンクを表示できるようにする。

本文から「特別な部分」を見つける仕組みを 1 つにする。6.11 のパーマリンク、6.13 のメンション、6.16 の検索の強調も、この仕組みに乗せる。

**オーナーの要望**（2026-09-20）: 本文の URL をリンクにして別のタブで開きたい。下の DoD の 3 つ目がそれにあたるので、フェーズは足さない。

範囲が大きいので、**表示（6.10a）と入力欄（6.10b）に分ける**（オーナーの判断。2026-09-21。ADR 0051）。
DoD の 3 項目は表示だけで満たせる。

**オーナーと確定した内容**（2026-09-21）
- 記法は Slack の mrkdwn 寄り（`*太字*` `_斜体_` `~取り消し~` `` `code` `` ` ``` ` `> 引用` `- リスト`）。Markdown のサブセットにはしない
- 本文はテキストのまま保存し、表示するときに解釈する。6.10b の入力欄も、この記法のテキストを書き出す

### Phase 6.10a — 本文の書式の表示

**ADR で決めること** ← 完了（ADR 0051。オーナーの確認: 2026-09-21）
- 記法と保存する形 → **mrkdwn 寄りの記法をテキストのまま保存**。記号の境界は「ASCII の英数字でないこと」（日本語の文中でも効く）
- 解釈をどこで行うか → **Web**。本文を木に分ける関数を 1 つにし、メンションと URL もそこで見つける。サーバーは本文をそのまま返す
- XSS を起こさない描画 → **React の要素に写すだけ**。`dangerouslySetInnerHTML` と HTML の文字列を使わない
- コードの中のメンション（ADR 0041 の宿題）→ **表示も件数も除外**。サーバーはコードの範囲だけを解釈し、規則は Go と TypeScript で共通の JSON のテストを読む
- システムメッセージと既存のメッセージ → 影響なし / 次の表示から新しい解釈（マイグレーションなし）

**構築順**（PR を分ける）
1. 設計（ADR 0051） ← このフェーズの最初の PR
2. デザイン: 解釈（`lib/chat/body-format.ts`）と描画（`MessageBody` の置き換え）を作り、各書式・コードブロック・引用・リスト・リンクの見た目を story に描いて `docs/ui/` に足し、オーナーに見てもらう
   （見た目を実物の解釈で確かめるため、解釈もここで作る。日時の整形の `lib/chat/format.ts` がすでにあるので、名前を ADR の仮の名前から変えた）
3. サーバー: `internal/chat/mention` でコードの範囲のトークンを除外する（共通の JSON のテスト）← 完了
   Go と TypeScript は `testdata/format/mentions.json`（「どのトークンがメンションになるか」の組）を読む。ADR の仮の名前（`code-spans.json`）から、守る約束に合わせて変えた
4. Web: スレッドの一覧とリンクのカードを同じ解釈にする、パーマリンクを同じタブで開く、`findPermalinks` の置き換え、`toWireBody` / `toInputBody` のコードの除外 ← 完了
   スレッドの一覧とカードの API はメンションの名前を返さないので、ワークスペースのメンバー一覧から名前を引く（一覧にいない人はトークンのまま）。
   カードを畳むのは今までどおり行数と文字数で、コードブロックの途中で切ったときだけ閉じるフェンスを足す（ADR の「木を作ってから畳む」より単純で、``` の対が壊れない点は同じ）。
   リストの記号を段で変えるトークン（`--list-style-type-circle` / `--list-style-type-square`）もここで足した

**DoD**
- [x] 各書式が表示され、既存のメッセージの表示が壊れない
      （記法は `body-format.test.ts`、描画は `message-body.test.tsx` の「MessageBody の書式」。書式のない本文が改行を保った段落 1 つになることも同じ節。アプリ由来のスクリーンショットを撮り直して既存の画面が変わらないことも確かめた）
- [x] `<script>` などを書いても、HTML として解釈されない（`message-body.test.tsx` の「<script> や HTML を書いても…」。`design-rules.test.ts` が `components/chat` の `dangerouslySetInnerHTML` を禁じる）
- [x] URL がリンクになり、別のタブで開く（`message-body.test.tsx` の「URL は別のタブで開くリンクにする」。パーマリンクだけは同じタブ）
- [x] コードの中のメンションはチップにならず、件数にも数えられない
      （Web は `message-body.test.tsx`、API は `internal/chat/mention_test.go` の `TestMentionInCodeIsNotCounted`。コードの範囲は `testdata/format/mentions.json` を Go と TypeScript の両方が読む。入力欄の変換は `mentions.test.ts`）

オーナーによる実物での確認は未実施。

### Phase 6.10b — リッチテキストの入力欄

**目的**: 入力欄をリッチテキストにし、書いている途中から書式が見えるようにする（Slack と同じ）。

**オーナーと確定した内容**（2026-09-21）
- ライブラリは Lexical（大きさは Tiptap とほぼ同じで、保存の形との噛み合いと IME で選んだ）
- 入力の補助はツールバー + ショートカット + 記号の入力（`*太字*` と打つとその場で太字になる）
- ほかのページから貼り付けた書式を残す（Slack と同じ）。そのために ADR 0051 の記法に文字付きのリンク `<URL|文字>` を足す（ADR 0051 決定 4 の追記）
- Slack のツールバーにある下線も持つ（ADR 0051 に `__下線__` を追記）。ツールバーは表示・非表示を切り替えられる（ADR 0052 の追記）

**ADR で決めること** ← 完了（ADR 0052。オーナーの確認: 2026-09-21）
- ライブラリ → **Lexical**。版を固定し、import するのは `components/chat/editor/` だけ
- 読み書き → **読み込みは ADR 0051 の `parseBody`、書き出しは自前**。往復のテストで同じ木に戻ることを保証する。記法で書けない書式は書き出しで落とす
- 入力欄の値 → **送る形のテキスト**（メンションはトークン）。`toWireBody` / `toInputBody` は消す
- メンション → 分けられないノード。補完はキャレットの位置に出す
- ツールバー（文字付きのリンクも作れる）・ショートカット（Slack の公式の一覧に合わせる）・記号の入力
- 貼り付け → **書式を残す**（Lexical の HTML の読み込みで検証済み）。記法にない見出し・表は段落に、下線・色は落とす
- Enter で送信・Shift + Enter で改行、16 行の上限（`--composer-max-lines`）はそのまま

**構築順**（PR を分ける）
1. 設計（ADR 0052） ← このフェーズの最初の PR
2. 記法の追加: `<URL|文字>` と `__下線__` の解釈と表示（`body-format.ts` / `MessageBody`。`testdata/format/mentions.json` に読み方がずれやすい例を足す）← 完了
   （デザインより先にした。ツールバーの下線とリンクのボタンが作るものを先に決めておかないと、story で押した結果を見せられないため）
3. エディタの芯: `components/chat/editor/` に読み込み・書き出し・メンションのノード。往復のテストを厚くする ← 完了
   （デザインより先にした。入力欄の中の書式・メンション・キャレットの位置の補完は、エディタがないと story で見せられないため。6.10a で解釈を先に作ったのと同じ）
   書けない書式は、書き出した本文を `parseInline` で読み直して意図と違えば、書式を 1 つずつ外して試す。斜体と下線が隣り合うと `_` が 3 つ続いて読めないので、下線が落ちる
4. デザインとつなぎ込み: ツールバー（デスクトップとモバイル、表示・非表示の切り替え）とリンクを入れる画面、入力欄の中の書式とメンションのチップ、キャレットの位置の補完、編集欄。
   story に描いて `docs/ui/` に足し、オーナーに見てもらう。入力欄と編集欄を置き換え、ショートカット・記号の入力・貼り付けを入れ、`toWireBody` / `toInputBody` を消す
   （入力欄は presentational な `Composer` の中を差し替えるので、画面を描くとアプリにもつながる。分けると同じ部品を 2 回触ることになる） ← 完了
   手で打った `@ハンドル` もメンションにする（ADR 0043 を引き継ぐ。ADR 0052 の「追記: 実装でわかったこと」）

**DoD**
- [x] 入力欄で付けた書式が、6.10a の記法のテキストとして送られ、同じ見た目で表示される
      （往復は `components/chat/editor/editor.test.ts`、入力欄での書式は `composer.test.tsx` の「Composer の書式」、送る本文は `workspace-screen.test.tsx`）
- [x] 送ったメッセージを編集で開くと、同じ書式とメンションのチップが入力欄に戻る（`message-item.test.tsx` の「opens the editor with the formatting and mention chips」、`workspace-screen.test.tsx` の「edits with the chips and saves ids」）
- [x] ほかのページ（Web ページ・Google ドキュメント・VS Code）から貼ると、記法で書ける書式が残る
      （Lexical の読み込みは ADR 0052 の「貼り付けの検証」、入力欄では `composer.test.tsx` の「ほかのページから貼ると…」。オーナーによる実物での確認は未実施）
- [x] 文字付きのリンクが表示され、ホバーで URL が見える。文字に `<` `>` `` ` `` があると文字付きのリンクにならない（`message-body.test.tsx`、`body-format.test.ts`、`testdata/format/mentions.json`）
- [x] Enter で送信・Shift + Enter で改行・16 行でスクロール・`@channel` の確認が今までどおり動く（`composer.test.tsx`、`workspace-screen.test.tsx`）
- [ ] 日本語の IME で変換している間に、書式やメンションの補完が壊れない（オーナーによる実物での確認。jsdom では確かめられない）

---

## Phase 6.10.5 — 未検証の email ではチャットを使えないようにする

**目的**: email を検証するまでチャットを使えないようにする。本番で本物の確認メールを送れるようにする。

ADR 0050 の宿題（オーナーの指摘。2026-09-21）。6.10 の後に回した（ADR 0051）。番号を振り直さないのは 6.7.5 と同じ理由。

**オーナーと確定した内容**（2026-09-21）
- 検証するまで chat を全部塞ぐ（読むのも含めて）
- chat は検証の状態をアクセストークンのクレームから知る
- 本番のメール送信も同じ ADR で決める
- ローカルの開発環境だけは、検証なしでも使えるようにする

**ADR で決めること** ← 完了（ADR 0053。オーナーの確認: 2026-09-21）
- 塞ぐ範囲 → chat の API と ws-ticket を 403（`email-unverified`）。auth の API は使える。判定は `platform/authn` のミドルウェアの 1 か所
- 検証の状態の渡し方 → アクセストークンの `email_verified` と `Identity.EmailVerified`。検証の直後に refresh する
- 招待から来た人 → 確認メールのリンクに戻り先（`next`）を載せ、検証のあとに招待の画面へ戻す（ADR 0030 の行き止まりも解消）
- 開発環境 → `AUTH_REQUIRE_VERIFIED_EMAIL=false`。本物のメールを送る設定（`smtp`）のときは外せない（起動しない）
- メール → SMTP で送り、業者は Resend から始める。`MAIL_TRANSPORT` は必須。プロセスの中のキューで非同期に送る（時間差を出さない）

**構築順**（PR を分ける）
1. 設計（ADR 0053） ← 完了
2. メール: SMTP の Mailer・非同期のキュー・設定（`MAIL_TRANSPORT` など）と `docs/deploy.md`（DNS のレコード） ← 完了（`internal/platform/mail`。ADR 0053 の追記）
3. 塞ぐ: トークンのクレーム・`Identity`・`RequireVerifiedEmail`・`AUTH_REQUIRE_VERIFIED_EMAIL`・確認メールのリンクの戻り先。CLAUDE.md ルール 1 を直す ← 完了（ADR 0053 の追記）
4. Web: 未検証のときの画面、検証の直後の refresh、403 のときの refresh、招待への戻り ← 完了（`docs/ui/README.md` の「Phase 6.10.5 で足した画面」）

**DoD**
- [x] 未検証のアクセストークンでは chat の API と ws-ticket が 403 になり、auth の API は使える（API のテスト。`internal/httpx/verified_email_test.go` の `TestUnverifiedEmailCannotUseChat`。止めるのは `internal/platform/authn/middleware_test.go` の `TestRequireVerifiedEmail`）
- [x] 検証すると、refresh した後のトークンで chat を使える（API のテスト。同じ `TestUnverifiedEmailCannotUseChat` の後半。検証の前に発行したトークンは止まったままであることも確かめている。auth 側は `internal/auth/service_test.go` の `TestAccessTokenCarriesEmailVerified`）
- [x] `smtp` のときに `AUTH_REQUIRE_VERIFIED_EMAIL=false` にすると起動しない（設定のテスト。`internal/platform/config/config_test.go` の「verified email cannot be skipped with smtp」）
- [x] パスワードの再設定の応答の時間が、登録のある人とない人で変わらない（メールを非同期で送る。`internal/auth/mailer_test.go` の `TestPasswordResetDoesNotWaitForMail`（送信が止まったままでも、どちらも戻る）。キューそのものは `internal/platform/mail/queue_test.go`）
- [x] 招待から登録した人が、確認メールを開くと招待の画面に戻る（Web のテスト。登録と再送で戻り先を送るのは `signup-page.test.tsx` の「puts the invite page into the verification link…」、リンクを開いたあとに戻るのは `verify-email-page.test.tsx` の「goes to the page in the link after verifying」。止められた画面から再送したときに、いまの画面を戻り先にするのは `(app)/layout.test.tsx` の「resends with the current page…」）
- [x] 本番の設定で、確認メールが実際に届く（オーナーによる確認。2026-09-22 に `hibari-chat.com` と Resend の本番の設定で、ローカルから Gmail に送って確かめた。SPF・DKIM・DMARC がすべて PASS。携帯キャリアは未確認で、オーナーの判断で届く前提にした。ADR 0053 の追記）

---

## Phase 6.11 — メッセージへのリンク

**目的**: メッセージへのリンクをコピーでき、リンクを本文に貼るとメッセージの中身が見えるカードが出るようにする（Slack と同じ）。あわせて、指定したメッセージへ飛ぶ仕組みを作る。

範囲が大きいので、**前半（6.11a）と後半（6.11b）に分ける**（ADR 0040）。前半だけで「コピーして貼ると中身が見える」は成立する。

**オーナーと確定した内容**（2026-09-19）
- メッセージのメニューに「リンクをコピー」を足す
- 本文にリンクがあると、リンク先のメッセージのカードを出す
- **長いメッセージは、カードの中だけ一部を表示して畳む。**「すべて表示する」で広げ、広げたあとも「折りたたむ」を残す。タイムラインの普通のメッセージは畳まない
- カードの中身は表示するときに取るだけ。リンク先が後で編集・削除されても、開き直すまでは追従しない
- **カードの中身は見る人ごとに authz を通して取る。** 本文には保存しない（貼った人は読めても、見る人は読めない private ルームがあるため）。読めないリンクは「表示できないメッセージ」のカードにする

### Phase 6.11a — リンクのコピーとカード

**ADR で決めること** ← 完了（ADR 0040）
- URL の形 → `/w/{workspaceID}/r/{roomID}?m={messageID}`（スレッドの返信は `&t={threadRootID}`）
- カードの中身をまとめて取る API → `POST /api/v1/messages/links`。見る人ごとに authz を通し、別のワークスペースでも読めるなら出す
- 権限のないメッセージのリンク → 「表示できないメッセージ」のカード。存在しない ID と区別しない
- 削除済みのメッセージのリンク → 同じ「表示できないメッセージ」のカード（ADR 0038 の「跡を残さない」に合わせる）

**DoD**
- [x] メニューの「リンクをコピー」でパーマリンクがクリップボードに入る（`workspace-screen.test.tsx` の「メッセージへのリンク（ADR 0040）」。スレッドの返信には親の ID（`&t=`）が付くことも確かめている。組み立てそのものは `links.test.ts` の `buildPermalink`）
- [x] 本文にリンクを貼るとカードが出て、長い本文は畳まれ、広げる・畳むができる（同じ節の「本文に貼ったリンクをカードにし…」で、貼った順に 1 回でまとめて取ることも確かめている。畳む・広げるは `message-link-card.test.tsx`、畳む規則は `links.test.ts` の `clampCardBody`、まとめ取りは `link-cards.test.ts`）
- [x] 読めないルームのメッセージのリンクは、中身を返さない（`internal/chat/message_link_test.go` の `TestResolveMessageLinksVisibility`、`TestResolveMessageLinksDM`、`TestResolveMessageLinksCrossWorkspace`）
- [x] 読めない・存在しない・削除済みが、API でもカードでも区別できない（`TestResolveMessageLinksIndistinguishable`、`TestResolveMessageLinksDeleted`、`internal/httpx/message_link_test.go` の `TestMessageLinkDeletedAndThread`。カード側は `views.test.ts` の「読めないリンクは unavailable にする」「削除済みのリンクも、読めないリンクと同じ見え方にする」）

オーナーによる実物での確認は未実施。飛ぶ側（リンクを開く・カードを押す）は Phase 6.11b。

### Phase 6.11b — 指定したメッセージへ飛ぶ

**ADR で決めること** ← 完了（ADR 0042）
- 指定したメッセージの前後を取る API → `GET /rooms/{roomID}/messages?around_message_id=`。応答に `has_more_after` と `around` を足す
- 見つからない ID（ないもの・読めないもの・削除済み）→ 区別せず、最新のページを `around: null` で返す
- 未読の位置へ飛ぶ → API は足さず `after_seq = last_read_seq` を使う。未読が読み込んだページより古いときだけバーを出す
- スレッドのクエリ → `thread` をやめて `t` に統一する（`?m=` と揃える。ADR 0037 の 1 点を置き換え）
- 実装は 2 回に分ける → サーバー（`around_message_id`）を先に入れ、Web は `docs/ui/` に新しい画面が入ってから

**構築順**（PR を分ける）
1. サーバー: `around_message_id`、`has_more_after`、`around` ← 完了（#60）
2. デザイン: 未読のバー、飛んできた先の強調、見つからなかったときの知らせ。story に描いて `docs/ui/` に足し、オーナーに見てもらう
   （あわせて、実装が先になっていた 6.11a のカードの画面も足した）
3. Web: 飛ぶ動き（`?m=` を開く・カードを押す）、未読のバー、`?thread=` → `?t=` の改名 ← 完了（ADR 0042 の追記）

**DoD**
- [x] コピーしたリンクを開くと、古いメッセージでもそこまで飛んで強調される。スレッドの返信ならパネルが開く（`workspace-screen.test.tsx` の「指定したメッセージへ飛ぶ（ADR 0042）」の 3 件。窓の置き換えと、スレッドのパネルの中で飛ぶところは `store.test.ts` の同名の節。画面の中ほどに置くのは `timeline.test.tsx`）
- [x] カードを押すとリンク先のメッセージまで飛ぶ（カードの遷移先がパーマリンクのパス（`views.test.ts` / `workspace-screen.test.tsx`）で、そのパスを開いたときに飛ぶのは上の 1 件目。押す動きそのものは `next/link` に任せる）
- [x] 未読のあるルームを開くと新着の線が出て、未読の位置へ飛べる（`workspace-screen.test.tsx` の「未読が読み込んだページより古いときだけバーを出し…」と「未読がページの中にあるなら、線だけでバーは出さない」。`after_seq` で読み直すところは `store.test.ts`）

オーナーによる実物での確認は未実施。

**意図的に残したもの**
- 飛んだ先から上に読み足すときの「もっと古い方」は既存のまま。下（新しい方）に読み足す経路だけを足した（ADR 0042 の結果）
- `?thread=` で作った古い URL は読まない（まだリリースしていない。ADR 0042 決定 6）

---

## Phase 6.12 — ピン留めと保存

**目的**: チャンネルにメッセージをピン留めする機能と、自分用にメッセージを保存する（Slack の「後で」）機能を足す。

**オーナーと確定した内容**（2026-09-22）
- 保存は「進行中」「アーカイブ済み」「完了済み」の 3 つのタブまで作る。**リマインダーは作らない**（通知の経路を決める 6.14 の後に足す）
- ~~ピン留めしたら、チャンネルにシステムメッセージを残す~~ → 残さない（2026-09-22 にオーナーが Slack の実物で確かめて改めた。ADR 0054 決定 3 の追記）
- 保存したメッセージが読めなくなっても（ルームから外れた・削除された）行は残し、一覧では中身を伏せる。本人が外せる
- ピン留めできるのは投稿できる人。ルームごとに 100 件まで

**ADR で決めること** ← 完了（ADR 0054）
- ピン留めはルームで共有、保存は本人だけ。同期の経路 → ピン留めは `messages` の列にしてルームの `change_seq`（`message.updated`）。
  保存は `saved_messages` の行と、本人ごとの `change_seq`（`saved.updated` と `after_change_seq` の差分）
- ピン留めできる人と上限 → `authz.CanPinMessage`（いまは投稿できる人）、100 件
- 保存したメッセージが読めなくなったときの見え方 → 読むときに authz を通し、`unavailable` にする（読めないと削除済みを区別しない）
- 一覧を押したら 6.11 の仕組みでそのメッセージへ飛ぶ

**構築順**（PR を分ける）
1. 設計: ADR 0054 ← 完了
2. デザイン: メッセージのピンの印とメニュー、ピン留めのシステムメッセージ、ピン留めの一覧、「後で」の一覧（3 つのタブ・読めない行・外すときの確認）と入口。story に描いて `docs/ui/` に足し、オーナーに見てもらう
   ← 完了（`docs/ui/README.md` の「Phase 6.12 で足した画面」）
3. DB と API: ピン留め（列・システムメッセージ・上限）と保存（テーブル・本人ごとの `change_seq`・イベント）
   ← 完了（ピン留めは `internal/chat/pin.go`、保存は `internal/chat/saved.go`）
4. Web: ピン留めと「後で」をつなぎ、再接続の同期に保存の差分を足す
   ← 完了（ピン留めは `room-pins.tsx` と `lib/chat/pins.ts`、「後で」は `workspace-saved.tsx` と `lib/chat/saved.ts`）

**DoD**
- [x] ピン留めがルームの全員にリアルタイムに反映され、切断中の変化も同期で揃う（サーバーは `internal/chat/pin_test.go` の `TestPinAndUnpinMessage`（`message.updated` と差分）。Web は `store.test.ts` の「ピン留め（ADR 0054）」（イベントと差分で一覧を直す）と `workspace-screen.test.tsx` の同名の節）
- [x] 同じルームで多数の goroutine が同時にピン留めしても、100 件を超えない（`internal/chat/pin_test.go` の `TestConcurrentPinsRespectLimit`。95 件の状態から 20 本の goroutine が同時に付けて、成功は 5 件だけ）
- [x] 保存は本人にだけ見え、読めなくなったルームのメッセージは中身を返さない（`internal/chat/saved_test.go` の `TestSavedBecomesUnavailable`（外された private・削除済みを区別せずに伏せ、入り直すと戻る）、`TestSaveMessage`（`saved.updated` は本人だけ・`saved` は本人から見たときだけ））
- [x] 保存の状態の変更（タブの移動・外す）が、切断中の別の端末にも同期で揃う（サーバーは `TestSavedChangesSync` と `TestConcurrentSavesKeepChangeSeq`。Web は `store.test.ts` の「「後で」（ADR 0054）」（番号の飛びで差分を取る・`syncSaved`）と `realtime.test.ts` の再接続の節）
- [x] 一覧から元のメッセージへ飛べる（ピン留めの一覧と「後で」の行の遷移先がパーマリンクのパス（`views.test.ts` の `toPinnedMessageView` / `toSavedItemView`、`workspace-screen.test.tsx`）。そのパスを開いたときに飛ぶのは Phase 6.11b の DoD）

---

## Phase 6.13 — メンション

**目的**: 本文でユーザーをメンションし、メンションされた人に分かるようにする。

**オーナーと確定した内容**（2026-09-19）
- 個人・`@channel`・`@here` の 3 種類
- サイドバーに、未読とは別にメンションの件数のバッジを出す（色は attention の系統。デザインで確認する）
- 入力欄に `@` の補完。本文の `@名前` を押すとプロフィールのカード（6.9）が開く
- スレッドの中でメンションされた人は、そのスレッドに参加する（ADR 0036 の想定どおり、`thread_members` に行を足す）

**ADR で決めること** ← 完了（ADR 0041。オーナーの確認: 2026-09-19）
- 本文での表し方 → `<@userID>` / `<!channel>` / `<!here>` で保存し、表示のときに名前へ置き換える。対象はサーバーが本文から決める
- **件数の数え方。** → `message_mentions` に行を積み、「既読位置より後の行」を数える。`@channel` は 1 行だけ書く。カウンタの列は持たない
- `@here` の対象 → 送った瞬間にオンラインのルームのメンバー（presence はトランザクションの外で読む）
- `@channel` / `@here` を使える人を絞るか → 最初は投稿できる人なら誰でも。判定は authz に置いて後から絞れるようにする
- スレッドの中の `@channel` の対象 → 誰も対象にしない（Slack と同じ。スレッドの中の `@channel` / `@here` は通知しない）。「チャンネルにも投稿する」を付けた返信はルームの全員
- ルームのメンバーでない人をメンションしたとき → 知らせない（行を作らない）。入力欄の警告は Web の ADR で決める
- 編集でメンションを足した・消したときの件数 → 行は本文に合わせて作り直す。足した分は、まだ未読のメッセージでだけ数える

**DoD**
- [x] メンションされた人のサイドバーに件数が出て、ルームを読むと消える（`internal/chat/mention_test.go` の `TestMentionCountsAndClearsOnRead`（自分の発言は数えない・既読で消える・読んだ後のメンションはまた数える）、`TestMentionRowsFollowTheBody`（編集で足した分・消した分）、`TestMentionLeavingRoomClearsTheCount`。Web は `messages.test.ts` の `applyMessageToRoom` / `applyReadToRoom` の件数、`workspace-screen.test.tsx` の `counts a mention in another room in the sidebar`）
- [x] `@channel` はルームの全員、`@here` はオンラインの人に数えられる（`TestMentionChannelAndHere`（全員に 1 件・送信者と非メンバーには 0 件）、`TestMentionHere`（オンラインの人だけ・誰もいなければ 0 件））
- [x] スレッドの中でメンションされた人が、そのスレッドの参加中の一覧に入る（`TestMentionInThread` の `a personal mention in a thread reply counts and joins the thread`。同じテストで、スレッドだけの返信の `@channel` / `@here` は誰にも数えず、「チャンネルにも投稿する」を付けた返信では全員に数えることも確かめている）
- [x] 同じルームで多数の goroutine が同時に `@channel` を送っても、件数がずれずデッドロックしない（`TestSendChannelMentionConcurrent`。50 本の goroutine から同時に送って件数が 50 になる。行を積む形なので、増やすために取り合う行がない）

実装は ADR 0041（サーバー側）と ADR 0043（Web 側）のとおり（設計 → デザイン → DB と API → Web）。オーナーによる実物での確認は未実施。

**意図的に残したもの**
- 編集で後から `@channel` / `@here` を足したときは、送信の確認ダイアログを出さない（ADR 0043 決定 6 は「送信の前」。Slack も編集では出さない）
- 本文の `@名前` を押したときのプロフィールのカードは Phase 6.9 の担当。いまは押せる見た目だけで何も起きない
- サイドバーが写っている `docs/ui/` のスクリーンショットは、未読の出し方が変わったので撮り直しが要る（オーナーの環境で `make web-shots`）

---

## Phase 6.14 — ミュートとブラウザ通知

**目的**: チャンネルをミュートできるようにし、タブが開いている間はブラウザの通知で知らせる。

Push 通知（APNs / FCM）は Phase 7 以降のまま。ここで作るのは、ブラウザが開いている間だけ届く Web Notifications。

範囲が大きいので、**ミュートと通知の設定（6.14a）とブラウザ通知（6.14b）に分ける**（オーナーの判断。2026-09-22）。
6.14b の通知は 6.14a の設定を読んで出すかを決めるので、設定を先に作る。

**オーナーと確定した内容**（2026-09-22）
- ミュートしたチャンネルはサイドバーから隠さず、薄くして残す。未読を太字にせず、未読数も出さない。メンションのバッジは出す
- 通知の設定は全体（すべて / メンションと DM / なし）とチャンネルごと（すべての新しい投稿 / メンションのみ）の 2 段。キーワード通知と通知のスケジュールは作らない
- 一時的なミュート（1 時間・明日まで）も作る

### Phase 6.14a — ミュートと通知の設定

**ADR で決めること** ← 完了（ADR 0055）
- ミュートの意味 → 通知を全部止め、サイドバーでは薄くする。未読数とメンションの件数はこれまでどおり数える（見せ方だけを変える）
- 設定の持ち方 → 全体はワークスペースごとの `workspace_members.notify_level`（最初はユーザーごとにしたが、オーナーの判断で改めた）、チャンネルごとは `room_members` の `notify_level` / `muted` / `muted_until`。期限は読むときに `Clock` で落とす
- 同期 → 本人宛ての `notifications.updated` / `room.notifications_updated`。再接続ではルームの一覧と全体の設定を取り直す

**構築順**（PR を分ける）
1. 設計: ADR 0055 ← 完了
2. デザイン: ヘッダーの「通知」のメニュー（チャンネル / DM）、一時的なミュート、サイドバーの薄い表示、ユーザー設定の「通知」。story に描いて `docs/ui/` に足し、オーナーに見てもらう ← 完了（`docs/ui/README.md` の「Phase 6.14a で足した画面」）
   「明日まで」は明日いっぱい（`muted_until` は翌々日の 0:00。端末のタイムゾーンで区切る。オーナーの判断、2026-09-22）
3. DB と API: マイグレーション、`GET` / `PUT /workspaces/{id}/me/notifications`、`PUT /rooms/{id}/me/notifications`、ルームの応答の `notifications`、`notifications.updated` / `room.notifications_updated` ← 完了
   期限の来たミュートを落とすのは Go の `roomNotificationsOf` 1 か所（カスタムステータスの `statusOf` と同じ）
4. Web: ヘッダーの「通知」のメニュー、サイドバーの薄い表示、ユーザー設定の「通知」、イベントと再接続の取り直し、期限のタイマー ← 完了
   期限が来たミュートは、ストアがいちばん早い期限にタイマーを張って戻す（`lib/chat/store.ts` の `scheduleMuteExpiry`）

**DoD**
- [x] ミュートしたチャンネルは未読が強調されず、メンションの件数は出る
      （`sidebar.test.tsx` の「ミュートしたルームは薄くし…」、`workspace-screen.test.tsx` の「ミュートと通知の設定」、
      サーバーが件数を変えないことは `internal/chat/notification_test.go` の「ミュートしても未読数は数える」）
- [x] 一時的なミュートは期限が来ると、再読み込みなしで元に戻る
      （`store.test.ts` の「一時的なミュートは、期限が来たら再読み込みなしで戻る」。偽のタイマーで確かめている。サーバーは `TestSetRoomNotifications` の期限切れ）
- [x] 設定の変更が本人のほかのタブにも揃い、切断中の変更も再接続で揃う
      （`internal/httpx/notification_test.go` の `TestWSNotificationEvents`、`store.test.ts` のイベントの節、
      `realtime.test.ts` の「after reconnecting, reads the rooms' and the workspace's notification settings again」）

ヘッダーのメニューの実物での確認は未実施（ローカルのワークスペースにチャンネルがない）。ユーザー設定の「通知」は実物の API で読めることを確かめた。

### Phase 6.14c — スレッドのミュート

**オーナーの要望**（2026-09-22）: Slack と同じく、スレッドごとに通知を止められるようにする。6.14a の後に、別の ADR で扱う。
番号は 6.14b の後だが、**6.14b より先に作る**。6.14b の通知の規則（ADR 0055 決定 1 の「参加しているスレッドの返信」）が、
スレッドの設定を読むことになるため（6.14a を先にしたのと同じ理由）。

**オーナーと確定した内容**（2026-09-22）
- Slack の「返信の通知をオフにする」: オフにしてもスレッドへの参加は残し、一覧にも残す。未読は数え、見せ方だけを変える。メンションを含む返信は通知の対象のまま
- 参加していないスレッドを「新しい返信の通知を受け取る」でフォローする操作も作る
- スレッドの中の `@channel` / `@here` でも対象の人をスレッドの参加者にする（Slack の実物に合わせ、ADR 0041 を改める）

**ADR で決めること** ← 完了（ADR 0056。オーナーの確認: 2026-09-22）
- 持ち方 → `thread_members.notify_replies`。返信やメンションで参加し直しても戻さない
- 見せ方 → スレッドの一覧で強調せず、サイドバーの「スレッド」のバッジに数えない（未読のメンションがあれば数える）
- スレッドの `@channel` / `@here` → 対象の人を参加させ、メンションとして数える
- 1 対 1 の DM のスレッド → 2 人とも参加者にする（Slack の既定）
- 同期 → 本人宛ての `thread.notifications_updated`。再接続では参加中のスレッドの一覧を取り直す

**構築順**（PR を分ける）
1. 設計: ADR 0056（ADR 0041 の改め） ← 完了
2. デザイン: スレッドの「…」の「返信の通知をオフにする」/「新しい返信の通知を受け取る」、スレッドの一覧のオフの行 ← 完了（`docs/ui/README.md` の「Phase 6.14c で足した画面」）
3. DB と API（スレッドの `@channel` / `@here` の参加、DM のスレッドのマイグレーションを含む） ← 完了
   返信のない親はフォローできない（参加中のスレッドの一覧は最後の返信の時刻で並べるため。404）。編集で足したメンションでは参加させない（送信のときだけ）
4. Web: 「…」と一覧の「その他」の切り替え、`thread.notifications_updated`、一覧の `@N` とサイドバーのバッジ ← 完了

**DoD**
- [x] スレッドの返信の通知をオフにすると、そのスレッドは一覧で強調されず、サイドバーのバッジにも数えられない。メンションの件数は出る
      （`internal/chat/thread_notifications_test.go` の `TestSetThreadNotifications`、`thread-list.test.tsx`、`threads.test.ts` の「返信の通知」、
      `workspace-screen.test.tsx` の「返信の通知（ADR 0056）」）
- [x] 参加していないスレッドをフォローすると、一覧に加わり、以後の返信が未読になる
      （`TestSetThreadNotifications` の「参加していないスレッドをフォローすると…」、`workspace-screen.test.tsx` の「新しい返信の通知を受け取る」）
- [x] スレッドの中の `@channel` / `@here` で、対象の人がスレッドの参加者になる（`mention_test.go` の `TestMentionInThread` / `TestMentionHereInThread`）
- [x] 設定の変更が本人のほかのタブにも揃い、切断中の変更も再接続で揃う
      （`internal/httpx/notification_test.go` の `TestThreadNotificationsAPI`、`store.test.ts` の `thread.notifications_updated`。
      再接続では参加中のスレッドの一覧を取り直す（これまでどおり。`notify_replies` も一緒に揃う））

実物での確認は未実施（ローカルのワークスペースにチャンネルがない）。

### Phase 6.14b — ブラウザ通知

**オーナーと確定した内容**（2026-09-22）
- ミュートしたチャンネルでメンションされても、通知は出さない（ADR 0055 決定 1 のまま）
- 通知にメッセージの本文を出す。本文を隠す設定は作らない
- 通知の音を鳴らす

**ADR で決めること** ← 完了（ADR 0057。オーナーの確認: 2026-09-22）
- 通知する条件 → ADR 0055 / 0056 の規則。どのタブも見えていないときだけ。`@here` と編集・再接続の差分では出さない
- 複数のタブで 1 回だけ → Web Locks の `hibari:notifier` を持つタブが出す。見え方は `BroadcastChannel` で知らせ合う。`tag` はメッセージの ID
- 許可を求めるとき → サイドバーの上の「デスクトップ通知を有効にする」の帯を押したとき。拒否されたら出そうとしない
- `Delivery` との関係 → 配信先は増やさない。クライアントが WebSocket のイベントを通知に変えるだけ
- 押したら → そのメッセージへ飛ぶ（ADR 0042）
- 音 → Web Audio で合成する。オン・オフは端末ごと（localStorage）

**構築順**（PR を分ける）
1. 設計: ADR 0057 ← 完了
2. デザイン: サイドバーの上の帯、ユーザー設定の「通知」の許可の状態と「通知音」 ← 完了（`docs/ui/README.md` の「Phase 6.14b で足した画面」）
3. Web（判定の関数、通知係のタブ、許可、音、押したときの移動。サーバーの変更はない） ← 完了
   判定は `lib/chat/desktop-notification.ts` の `shouldNotify`、通知係は `lib/chat/desktop-notifier.ts`、端末ごとの状態は `lib/notification-prefs.ts`

**DoD**
- [x] 別のタブを見ている間にメンションされると、通知が 1 回だけ出る。押すとそのメッセージへ飛ぶ
      （`desktop-notification.test.ts` の規則の表と中身、`desktop-notifier.test.ts` の「ロックを持つタブだけが出し…」「どれかのタブが見えていれば出さない」「押されたらそのメッセージを開く」、
      `realtime.test.ts` の「hands each event to onEvent after applying it to the store」）
- [x] 通知を許可しないと、通知を出そうとしない（`desktop-notifier.test.ts` の「許可されていなければ出そうとしない」、`workspace-screen.test.tsx` の「デスクトップ通知の帯」）
- [x] 通知を出すときに音が鳴り、ユーザー設定で止められる（`desktop-notifier.test.ts`、`notification-prefs.test.ts`、`settings-sections.test.tsx`）

実物では、開発サーバーで画面が崩れないこととコンソールにエラーがないこと（2 つのタブ）を確かめた。内蔵ブラウザは通知を拒否しているので、実際に通知が出るところは未確認（オーナーの Chrome で確かめる）。

---

## Phase 6.14.5 — サイドバーのメニューとアクティビティ

**目的**: サイドバーの左にアイコンと文字のメニューを置き、サイドバーの中身を切り替えられるようにする。
メニューの 1 つの「アクティビティ」に、通知の対象になったメッセージを並べる（Slack と同じ）。

**オーナーの要望**（2026-09-21）
- Slack のサイドバーは、チャンネルと DM の一覧（ホーム）の左に、アイコン + 文字のメニュー（ホーム・DM・アクティビティ…）があり、押すとサイドバーの中身が切り替わる
- アクティビティには、通知の対象のメッセージが一覧で出る。**チャンネルごとではなくメッセージ単位**で、同じチャンネルの通知が複数並ぶ

6.14 の後に置く（オーナーの判断。2026-09-21）。アクティビティに並べるのは「通知の対象」なので、6.14 で何を通知するかを決めた後に作ると作り直しがない。
番号を 6.15 にしないのは、既存の ADR とロードマップがフェーズ番号で互いを指しているため（6.7.5 と同じ入れ方）。

**オーナーと確定した内容**（2026-09-22）
- メニューはホーム・DM・アクティビティ・後で。「後で」はホームから出してメニューに移す。スレッドの一覧はホームに残す
- 「DM」は最後のメッセージつきの一覧
- アクティビティに並べるのは、通知の対象と同じもの・自分のメッセージへのリアクション。フィルターのタブを作る
- 既読はいまの既読位置から導く。1 件ごとの状態とクリアは作らない

**ADR で決めること** ← 完了（ADR 0058。オーナーの確認: 2026-09-22）
- メニューに何を置くか → ホーム・DM・アクティビティ・後で。開いているメニューは URL のクエリ `side` に持つ。一覧をどの列に出すかとモバイルの出し方はデザインで決める
- アクティビティに並べるもの → 通知の規則（ADR 0057 決定 1）から「タブが見えていない」を外し、`@here` をメンションに数えたもの + 自分のメッセージへのリアクション。タブは「すべて / DM / メンション / スレッド / リアクション」と「未読メッセージ」の切り替え
- 既読の持ち方 → ルームとスレッドの既読位置から導く。リアクションは未読を持たない。メニューのバッジは未読の件数（99+ まで）
- 一覧の API → `GET /workspaces/{id}/activity`（`(occurred_at, id)` のカーソル）と `unread_count`。メッセージはクライアントが `message.created` から足し、リアクションだけ本人宛てのイベント。`room_members` で読めるルームに絞る
- 押したら ADR 0042 の仕組みでそのメッセージへ飛ぶ
- DM の一覧 → ルーム一覧がすでに返している `last_message` / `last_message_at` で描く（サーバーの変更なし）

**構築順**（PR を分ける）
1. 設計: ADR 0058 ← 完了
2. デザイン: 左のメニュー（デスクトップとモバイル）、アクティビティの一覧、DM の一覧 ← 完了（`docs/ui/README.md` の「Phase 6.14.5 で足した画面」）
3. サーバー: アクティビティの API・未読の件数・リアクションのイベント、通知の規則の共有のテストデータ ← 完了
4. Web: メニューと URL、アクティビティ・DM の一覧、リアルタイムの追加、「後で」の移動 ← 完了

**DoD**
- [x] 左のメニューでサイドバーの中身が切り替わり、今いる画面が分かる（`workspace-screen.test.tsx` の「左のメニューとアクティビティ」、`side-nav.test.tsx`）
- [x] アクティビティに通知の対象のメッセージがメッセージ単位で並び、新しいものがリアルタイムに加わる（`activity_test.go`、`store.test.ts` の「アクティビティ」）
- [x] 読めなくなったルームのメッセージはアクティビティに出ない（API のテスト。`activity_test.go` の `TestActivityHidesUnreadableRooms`）
- [x] 押すとそのメッセージへ飛ぶ（`views.test.ts` の `toActivityItemView`、`workspace-screen.test.tsx`）
- [x] ルームを読むと、アクティビティのそのメッセージも既読になり、メニューのバッジが減る（`activity_test.go`、`store.test.ts`）
- [x] 自分のメッセージにリアクションが付くと、アクティビティに加わる（`activity_test.go` の `TestActivityReactions`、`store.test.ts`）
- [x] DM の一覧に、相手ごとの最後のメッセージが新しい順に並ぶ（`workspace-screen.test.tsx`）
- [x] 通知の規則のテストデータを、Go と Web のテストが両方読んでいる（`testdata/notification-rules.json` を `activity_rules_test.go` と `notification-rules.test.ts` が読む）

実物では、開発サーバーで左のメニューの切り替え（`?side=activity` で API を読む）・ホバーで重ねた一覧・コンソールにエラーがないことを確かめた。
ローカルのワークスペースにチャンネルと DM がないので、アクティビティに 1 件が並ぶところとリアクションの追加は、テストでだけ確かめている。

---

## Phase 6.15 — チャンネルのアーカイブと削除

**目的**: 使わなくなったチャンネルをアーカイブ（読み取り専用）にし、不要なら削除できるようにする。

**オーナーと確定した内容**（2026-09-23）
- できる人は Slack と同じ。アーカイブと復元はそのチャンネルのメンバー、削除は admin 以上
- 削除したチャンネルの添付ファイルはストレージから消す（Slack は残すが、hibari の添付はメッセージからしかたどれない）
- アーカイブしたチャンネルはサイドバーから外し、サイドバーの検索で探せるようにする（「ディレクトリ」の画面は作らない）
- アーカイブ中の名前は使えないまま

**ADR で決めること** ← 完了（ADR 0059。オーナーの確認: 2026-09-23）
- できる人（案: admin 以上）。`is_default` のルームと DM は対象外にするか → 上の確定のとおり。`is_default` と DM は対象外
- アーカイブ中に禁止する操作（投稿・編集・リアクション・参加など）と、その判定を authz に集める形 → ルームの状態を authz の引数に足す。本人だけの状態（既読・保存・通知の設定）は許す。止めた操作は 409 `room-archived`
- 削除したときの添付ファイルの掃除（既存の掃除ジョブとの関係）と、メッセージのリンク・ピン留め・保存の見え方 → 行ごと消し、オブジェクトのキーを `storage_deletions` に写して既存の掃除ジョブが消す。リンクは「アクセスできません」
- 購読中のユーザーへの即時の反映（絶対ルール 8 と同じく、サーバー側で購読を解除してイベントを配信する） → アーカイブは `room.updated` の `archived_at`（購読は残す）。削除は `room.deleted` を配り、Hub が購読を外す
- アーカイブを戻せるか → 戻せる（メンバーも残る）

**構築順**（PR を分ける）
1. 設計: ADR 0059 ← 完了
2. デザイン: アーカイブ中の入力欄の代わり・ルームの設定のアーカイブ / 復元 / 削除と確認・サイドバーの検索のアーカイブの印 ← 完了（`docs/ui/README.md` の「Phase 6.15 で足した画面」）
3. サーバー: authz の引数・アーカイブ / 復元 / 削除の API・`room.deleted` と購読の解除・`storage_deletions` と掃除ジョブ ← 完了
4. Web: 設定の操作・アーカイブの表示・`room.deleted` の反映 ← 完了

**DoD**
- [x] アーカイブしたチャンネルは読めるが、投稿などは API で拒否される（`room_archive_test.go` の `TestArchivedRoomOperations`（止める操作は 409、本人だけの状態の操作は通る）と `TestArchiveRoomConcurrentWithSends`、`authz_test.go` の全組み合わせ、`internal/httpx/room_archive_test.go`）
- [x] アーカイブ・削除が、開いている全員の画面に即座に反映される（サーバーは `room.updated` の `archived_at` と `room.deleted` を配り、削除では Hub が購読を外す: `TestArchiveRoom`・`TestDeleteRoom`・`hub_test.go` の `TestDeliverClosesDeletedRooms`。画面は `workspace-screen.test.tsx` の「開いているチャンネルが削除されたら」「ほかの人がアーカイブしたら」と `store.test.ts` の「アーカイブと削除」）
- [x] 削除したチャンネルの添付ファイルがストレージから消える（`TestDeleteRoom`: 猶予の 15 分の前は残し、過ぎると削除の後に PUT されたものも含めて消える）

---

## Phase 6.16 — 検索

**目的**: メッセージを検索できるようにする。

**オーナーと確定した内容**（2026-09-23）
- 方式は **pg_bigm**（`pg_trgm` / `pg_bigm` / PGroonga を実物で測った結果を見て確定。ADR 0061 の「検証の結果」）
- 並び順は**新しい順だけ**。関連度順は作らない
- 絞り込みは、Slack 風の**修飾子（`in:` `from:` `before:`）とフィルターの UI の両方**
- 検索の対象は**読める範囲の全部**: DM・アーカイブ済みチャンネル・スレッドの返信・参加していない public チャンネル

**ADR で決めること** ← 完了（ADR 0061。オーナーの確認: 2026-09-23）
- 日本語の検索の方式（Postgres 標準の全文検索は日本語を分かち書きできない。`pg_trgm` / `pg_bigm` / 別の検索エンジンを比べる。ローカルの compose と本番の Fly.io で同じものを動かせるか） → pg_bigm。`postgres:16-alpine` に pg_bigm を足した自前のイメージを compose・CI・Fly で共有する。索引は `lower(normalize(body, NFKC))` の GIN（大文字小文字と全角半角を吸収する）
- 結果の authz（見る人が読めるルームのメッセージだけ。public ルームは参加していなくても読める）と、それを N+1 にならずに絞る方法 → `readable_rooms` の CTE 1 つにまとめ、`authz.CanReadRoom` と同じ表を DB のテストでも回す
- 絞り込み（ルーム・送信者・日付など）とカーソル方式のページング → 修飾子はクライアントが解釈し、API は ID と日時だけを受け取る。カーソルは `(created_at, id)`
- 削除・編集されたメッセージの扱い、スレッドの返信の扱い → 削除済みとシステムメッセージは部分索引から外す。編集は `messages.body` を引くので自動。スレッドの返信も対象にし、押したらスレッドを開く
- 結果を押したら 6.11 の仕組みでそのメッセージへ飛ぶ。一致した部分の強調は 6.10 の仕組みに乗せる → そのとおり。強調はクライアントで重ねる（サーバーは HTML を作らない）

**構築順**（PR を分ける）
1. 設計: ADR 0061 ← 完了
2. 基盤: pg_bigm 入りの Postgres イメージ（compose・CI・`docs/deploy.md`）と、拡張・索引のマイグレーション ← 完了
3. デザイン: 検索の入力欄・結果の画面・フィルター・0 件の表示。story に描いて `docs/ui/` に足し、オーナーに見てもらう
4. サーバー: 検索の API（authz の CTE・条件の組み立て・カーソル）
5. Web: 修飾子の解釈と整形・結果の画面・結果から飛ぶ

**DoD**
- [ ] 日本語と英語で検索でき、読めないルームのメッセージは結果に出ない（API のテスト）
- [x] 2 文字の日本語で索引が使われる（`db/search_index_test.go` の `TestMessageSearchUsesIndex`。`enable_seqscan = off` で索引の道を選ばせ、計画に `messages_body_search_idx` が出ることを見る）
- [x] 大文字小文字と全角半角の違いを吸収する（`Deploy` / `ｄｅｐｌｏｙ` で `deploy` が見つかる: `TestMessageSearchNormalization`）
- [ ] 削除したメッセージは結果に出ず、編集後の本文で見つかる
- [ ] 修飾子とフィルターの UI が同じ状態を編集する（`parseSearchQuery` / `formatSearchQuery` の往復のテスト）
- [ ] 結果から元のメッセージへ飛べる

---

## Phase 7 以降（任意）

- OAuth 2.0 + PKCE（未検証の email による自動紐付けはしない）
- 退会（email / handle の匿名化、全 family の失効、owner の場合は先に譲渡を必須にする）
- 本番のデプロイ（置き場所は ADR 0046 で決めた: Fly.io の 1 リージョンに Go / Next / Storybook / Postgres / Valkey、ストレージは R2。手順とドメインの取得はこのフェーズで）
- Tauri でのデスクトップ化
- APNs / FCM による Push 通知（`Delivery` の実装を 1 つ追加する）
- OpenTelemetry によるトレース
- REST への失効の即時反映（sid の拒否リスト。ADR 0007）

**スコープ外**: ブロック機能、グループ DM、ルーム単位のロール、カスタムロール
