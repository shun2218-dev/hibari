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
2. **ワークスペースとルームの画面（REST のみ）**: サイドバー、履歴の表示、既読。ログイン後の振り分けと、ワークスペースが 0 件のときの表示（デザインは `chat/empty-workspaces.png`、コンポーネントは `NoWorkspaces`） ← 完了（ADR 0025）
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
- 画面は日付の区切りと同じ中央寄せの 1 行（`chat/system-messages.png`）

**DoD**
- [x] チャンネルを作る・参加する・退出する・外される・名前を変えると、その行がタイムラインに残る
- [x] システムメッセージでは未読バッジが増えない
- [x] システムメッセージを編集・削除できない
- [x] DM にはシステムメッセージが出ない

---

## Phase 6.5 — スレッド

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

**DoD**
- [x] メッセージからスレッドを開いて返信でき、チャンネルのタイムラインには出ない（`workspace-screen.test.tsx` の threads。compose の実物での確認は未）
- [x] 親メッセージに返信数と最終返信が出て、リアルタイムに更新される（返信の削除で返信数が減る）（`TestThreadEvents`、`workspace-screen.test.tsx`）
- [x] スレッドの返信でチャンネルの未読数が増えず、サイドバーの並びも動かない。参加しているスレッドの未読が分かる（`TestSendThreadReply`、`store.test.ts` / `workspace-screen.test.tsx` の threads）
- [x] 切断中に届いたスレッドの返信も、再接続の同期（`after_change_seq`）で揃う（`TestSendThreadReply` の差分取得、再接続でパネルと一覧を取り直す `realtime.test.ts`。compose の実物での確認は未）
- [x] 同じ client_msg_id の再送でスレッドに二重投稿されない（`internal/chat/thread_test.go` の `TestSendThreadReplyIdempotent`）
- [x] 50 goroutine で同じスレッドに同時に返信しても、`thread_seq` に欠番も重複もなく、親の編集と並行してもデッドロックしない（`TestSendThreadReplyConcurrent`、`TestEditAndReplyConcurrentNoDeadlock`、`TestDeleteThreadReplyConcurrent`）
- [x] ルームから外れると、そのルームのスレッドは参加中の一覧と未読から消える（`TestThreadFollowGoneWhenLeavingRoom`、`db/schema_test.go` の `TestThreadMembersConstraints`）

---

## Phase 7 以降（任意）

- OAuth 2.0 + PKCE（未検証の email による自動紐付けはしない）
- 退会（email / handle の匿名化、全 family の失効、owner の場合は先に譲渡を必須にする）
- 本番のデプロイと、本番ストレージの最終決定（ADR 0008 の見直し）
- Tauri でのデスクトップ化
- APNs / FCM による Push 通知（`Delivery` の実装を 1 つ追加する）
- OpenTelemetry によるトレース
- REST への失効の即時反映（sid の拒否リスト。ADR 0007）

**スコープ外**: ブロック機能、グループ DM、ルーム単位のロール、カスタムロール
