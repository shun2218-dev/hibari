# 0019. セッションの一覧と失効、プロフィールの更新（Phase 6）

- 状態: 採用
- 日付: 2026-09-16

## 背景

Phase 6-1 で画面を実装したところ、`docs/ui/` にはあるのに API がない画面が 2 つ見つかった。

- `settings/devices.png`: ログイン中のデバイス（セッション）の一覧、1 つずつのログアウト、他のすべてからのログアウト
- `settings/profile.png`: 表示名とハンドルの変更、アバター画像の変更

Phase 2 で作ったのは register / login / refresh / logout / me / verify-email / password-reset までで、セッションを「一覧する」「他人（他の端末）の分を失効させる」手段と、プロフィールを変える手段がない。

## 決定

### エンドポイント

```
GET    /api/v1/auth/sessions              自分のセッションの一覧
DELETE /api/v1/auth/sessions/{sessionID}  1 つ失効させる
DELETE /api/v1/auth/sessions              いま使っているセッション以外をすべて失効させる
PATCH  /api/v1/users/me                   display_name / handle
```

すべて Access Token が要る（`authn.Require`）。

### セッションの一覧

- **セッション = `refresh_tokens.family_id`**（= Access Token の `sid`。ADR 0007）。ローテーションで行は増えるが、1 つの family が 1 つのログインを表す。
- 「有効」は `revoked_at IS NULL AND expires_at > now`。family の中の最新の行だけを見る（古い行は `rotated` で失効済み）。
- 返すもの: `id`（family_id）、`user_agent`、`started_at`（family の最初の行）、`last_used_at`（最新の行）、`current`（`sid` と一致するか）。**IP は返さない**。
- 並びは `last_used_at` の新しい順。
- `user_agent` は保存したまま返し、「Chrome · macOS」のような**表示用のラベルはクライアントが作る**。

### 失効

- 1 つの失効は、既存の family 単位の UPDATE（`RevokeRefreshTokenFamily`）を `user_id` の条件付きで使い、`revoked_reason = 'logout'` にする。
- 他人のセッション ID を指定されたときや、すでに失効しているときは **404**（他人のセッションの存在を明かさない）。
- 「他のすべて」は `user_id` が同じで `family_id <> sid` の行を 1 文で失効させ、**失効した family ごとに `auth:revoked` を publish** する。ユーザー単位の publish（`RevokeAllSessions`）は使わない。いま使っているセッションまで WebSocket が切れてしまうため。
- 失効した瞬間に切れるのは WebSocket だけで、相手の Access Token は最長 15 分残る（ADR 0007 の「REST への即時反映は Phase 7」）。画面にもそう書く。
- 自分がいま使っているセッションを 1 つ失効させることもできる（ログアウトと同じ）。画面には出さないが、API としては拒否しない。

### プロフィールの更新

- 変えられるのは `display_name` と `handle` だけ。**email は含めない**（変更には確認メールのフローが要るので、必要になった時点で別に決める）。
- 入力の検証は登録と同じ規則（`handle` は `^[A-Za-z0-9_]{3,32}$`、`display_name` は 50 文字まで・制御文字なし）。
- 省略した項目は変えない（部分更新）。両方とも省略したリクエストは、何も変えずに現在の値を返す。
- `handle` の重複は登録と同じく **409**（`ErrHandleTaken`）。先に SELECT で確かめず、UNIQUE 制約の違反として受け取る。

### アバター画像は入れない

`settings/profile.png` の「画像を変更」に対応する API は、この段階では作らない。理由は「結果」に書く。

## 理由

- **セッションを family で表す理由**: 失効の単位（ADR 0007）と、画面が見せたい単位（1 回のログイン = 1 台の端末）が同じ。行（トークン）単位で見せると、ローテーションのたびに増えて意味をなさない。
- **IP を返さない理由**: デザインから地名を落としたのと同じ理由で、IP そのものも画面で使い道がない。監査のために DB には残すが、API で出すと「自分の IP を他人に見せる」経路を増やすだけになる。
- **User-Agent を解析しない理由**: 解析の規則は表示の都合（「hibari for iOS · iPhone 15」）で変わる。サーバーに置くと、表示を変えるたびにサーバーのデプロイが要る。生の値は保存済みなので、クライアントで訳し分けるほうが直しやすい。
- **「他のすべて」で family ごとに publish する理由**: `RevokeAllSessions` はユーザー単位のイベントで、受け取った側はそのユーザーの接続を全部切る。いま操作している本人の画面まで切れてしまう。
- **email を含めない理由**: email は本人確認の宛先で、変えるときは新しいアドレスの確認が要る（確認できるまで古いアドレスを残す、など）。「表示名を変える」のと同じ重さではないので、同じ PATCH に混ぜない。

## 検討した代替案

- **`POST /api/v1/auth/sessions/{id}/revoke`**: 動詞をパスに置く形。失効は「セッションという資源を消す」ことなので DELETE にした。
- **セッションに名前を付けられるようにする（「仕事用の MacBook」）**: デザインになく、`refresh_tokens` に列が要る。必要になってから。
- **`devices` テーブルを使う**: Phase 7 の Push 通知用に器だけ作ってある。いまはどのログインでも行を作っていないので、セッションの一覧には使えない。Push を入れるときに、device と family の関係を決める。

## 結果（トレードオフ）

- 失効しても、相手の Access Token は最長 15 分有効なまま（WebSocket は即座に切れる）。「すぐに締め出せる」と誤解させないよう、画面の文言で補う。
- アバター画像を入れないので、`settings/profile.png` の「画像を変更」は Phase 6 では押せないままになる。入れるには (1) 署名付き URL でのアップロードと HEAD による検証（ADR 0013 と同じ形）、(2) **画像のアバターをどの画面でどう出すかのデザイン**（いまのデザインは頭文字と色だけで、画像のアバターが 1 枚もない）、(3) プロフィールを返すすべてのレスポンスに署名付き URL を載せるかどうかの判断、の 3 つが要る。(2) が決まっていないので、API だけ先に作らない。
