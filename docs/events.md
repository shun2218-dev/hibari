# WebSocket イベント

WebSocket のプロトコルとイベントのスキーマの正本。設計の判断は ADR 0004（配信と差分取得）、0007（ws-ticket）、0014（change_seq）、0015（Hub と購読）。

- WebSocket は「確定した変更を速く届ける」経路にすぎない。正は常に REST と Postgres にあり、配信は落ちうる（ADR 0004）。
- JSON のフィールド名は `snake_case`、ID は ULID の文字列、時刻は RFC 3339。
- メッセージの形は REST（`GET /api/v1/rooms/{id}/messages` の各要素）と同じ。
- TypeScript の型（`ServerEvent` / `ClientMessage` / `Ack`）は `web/lib/api/types.gen.ts` にある。Go の型から生成する（ADR 0022、`make ts-types`）。

## 接続

1. `POST /api/v1/ws/ticket`（`Authorization: Bearer <access token>`）

   ```json
   { "ticket": "<43 文字>", "expires_in": 30 }
   ```

2. `GET /api/v1/ws?ticket=<ticket>` で WebSocket にアップグレードする。
   - ticket は 30 秒で失効し、1 回しか使えない。再接続のたびに発行し直す。
   - ticket が無効・期限切れ・使用済み、またはセッションが失効していたら、アップグレードせずに 401（`application/problem+json`、type `ws-ticket-invalid`）を返す。
   - Access Token や Refresh Token を URL に載せない。URL に載せてよいのは ws-ticket だけ。

- フレームはテキストで、1 フレームに JSON のオブジェクトを 1 つ入れる。
- クライアントからのフレームは 4 KiB まで。

## クライアント → サーバー

すべてのメッセージは `type` を持つ。`id` は任意の文字列（64 文字まで）で、付けると同じ `id` の `ack` が返る。

| type | 項目 | 説明 |
|---|---|---|
| `subscribe` | `room_id` または `workspace_id`（どちらか 1 つ） | 購読を始める。すでに購読していれば何もせず成功 |
| `unsubscribe` | `room_id` または `workspace_id` | 購読をやめる。購読していなくても成功 |
| `typing` | `room_id`、`thread_root_id`（任意） | 入力中であることを知らせる。購読中のルームだけ。入力している間、数秒ごとに送ってよい（サーバーが 5 秒に 1 回に間引く）。スレッドで入力しているときは親の ID を付ける（チャンネルとは別に間引く。ADR 0036） |
| `ping` | — | アプリケーションの疎通確認（ブラウザは WebSocket の ping フレームを送れないため）。`ack` が返る |

```json
{ "type": "subscribe", "id": "c1", "room_id": "01J8..." }
{ "type": "subscribe", "id": "c2", "workspace_id": "01J8..." }
{ "type": "typing", "room_id": "01J8..." }
{ "type": "typing", "room_id": "01J8...", "thread_root_id": "01J8..." }
```

## サーバー → クライアント

### ack

```json
{ "type": "ack", "id": "c1" }
{ "type": "ack", "id": "c1", "error": "not_found" }
```

`id` のないメッセージが失敗したときも、`id` を省いた `ack` でエラーを返す。

| error | 意味 |
|---|---|
| `invalid_message` | JSON として読めない、未知の `type`、項目の不足や形式の誤り |
| `not_found` | 購読の対象が存在しない、または読めない（存在の有無を区別しない）。`typing` の `thread_root_id` がこのルームのスレッドの親でない |
| `not_subscribed` | 購読していないルームに `typing` を送った |
| `forbidden` | 読めるが投稿できないルームに `typing` を送った（参加していない public など） |
| `too_many_subscriptions` | 1 つの接続の購読が上限（500 件）に達した |
| `internal` | サーバーの内部エラー。時間をおいて再試行する |

### イベント

```json
{ "type": "message.created", "data": { ... } }
```

「宛先」の列: **room** はそのルームの購読者、**workspace** はそのワークスペースの購読者、**本人** は該当するユーザーのすべての接続（購読の有無を問わない）。
複数の宛先に当たっても、1 つの接続には 1 回だけ届く（サーバーが複数台のときは、ごくまれに 2 回届くことがある。ADR 0016。クライアントはメッセージを `id` で上書きするので、表示は壊れない）。

| type | 宛先 | いつ |
|---|---|---|
| `message.created` | room | メッセージが送信された |
| `message.updated` | room | 本文が編集された。スレッドの親の `thread`（返信数・最終返信）が変わった（ADR 0036）。絵文字のリアクションが付け外しされた（ADR 0044）。添付ファイルが 1 件削除された（ADR 0045） |
| `message.deleted` | room | 削除された（`data` は tombstone） |
| `member.joined` | room、参加した本人 | ルームの作成・参加・追加・DM の作成・招待の受け入れでルームのメンバーになった |
| `member.left` | room | 退出した、または外された |
| `room.updated` | room（public ならワークスペースも） | 名前や `is_default` が変わった |
| `room.member_removed` | 本人 | 自分がルームから抜けた・外された |
| `room.read` | 本人 | 自分の既読位置が進んだ（別の端末を含む） |
| `workspace.updated` | workspace | 名前や `invite_policy` が変わった |
| `workspace.member_removed` | workspace、本人 | ワークスペースから退出した、またはキックされた |
| `workspace.role_changed` | workspace、本人 | ロールが変わった（owner の譲渡では 2 件） |
| `presence.changed` | そのユーザーが所属する workspace | オンライン / オフラインが変わった |
| `typing.started` | room（入力した本人の接続を除く） | 入力中になった |
| `thread.read` | 本人 | 自分のスレッドの既読位置が進んだ（別の端末を含む。ADR 0036） |
| `thread.followed` | 本人 | 自分がスレッドに参加した（自分の返信、自分の投稿への最初の返信、スレッドの中でのメンション。ADR 0041） |

#### `message.created` / `message.updated` / `message.deleted`

`data` はメッセージ（REST と同じ形）。`kind` が `system` のものは、参加や名前の変更のログ（ADR 0033）。
ログは `seq` と `change_seq` を消費するが `user_seq` は進めないので、未読数（`last_user_seq - last_read_user_seq`）には数えない。
編集・削除はできない。

```json
{
  "id": "01J8...", "room_id": "01J8...", "seq": 42, "change_seq": 57, "user_seq": 30, "kind": "user",
  "sender": { "id": "01J8...", "handle": "miyuki", "display_name": "高橋 みゆき" },
  "client_msg_id": "01J8...", "body": "こんにちは",
  "thread_root_id": null, "thread_seq": null, "also_in_channel": false, "thread": null, "attachments": [],
  "mentions": [{ "kind": "user", "user": { "id": "01J8...", "handle": "kohaku", "display_name": "kohaku" } }],
  "reactions": [{ "emoji": "👍", "count": 3, "users": ["01J8...", "01J8...", "01J8..."] }],
  "created_at": "2026-09-14T12:00:00Z", "edited_at": null, "deleted_at": null
}
```

`mentions` は本文にあるメンション（ADR 0041）。本文には `<@userID>` / `<!channel>` / `<!here>` が入っていて、
クライアントはこれを見て `<@userID>` を名前に置き換える。出現順で、重複はない。`kind` は `user` / `channel` / `here` で、
`user` のときだけ `user`（プロフィール）が入る。

**「自分宛てか」はイベントに載らない。** 配信は 1 つのペイロードを購読者に配る形なので（ADR 0015 / 0016）、受け取る人ごとの値を入れられない。
クライアントは `mentions` を見て自分で判断し、手元のバッジを増やす。`kind` が `channel` / `here` なら「自分も対象かもしれない」として増やすが、
**スレッドだけの返信（`thread_root_id` があって `also_in_channel` が false）では増やさない**（サーバーが数えないため。Slack と同じ）。
正しい値はルームの `mention_count`（REST）で、ルームを開くか一覧を取り直せば揃う。

#### 絵文字のリアクション（`reactions`。ADR 0044）

リアクションの付け外しには**専用のイベントを作らない**。付け外しでそのメッセージの `change_seq` が 1 つ進み、
`message.updated` として届く（再接続の差分（`after_change_seq`）にもそのまま乗る）。
クライアントから見れば「メッセージが 1 回編集された」のと同じで、`change_seq` の大きい方を残す規則（ADR 0014）のまま追従できる。

`reactions` は絵文字ごとの集計で、並びは**最初に付いた順**（数が増減しても入れ替わらない）。
`users` は付けた人の**先頭 8 人まで**の `user_id` で、`count` より少ないことがある（ホバーの「A、B 他 N 人」に使う）。

**`me`（自分が付けたか）はイベントに載らない。** `mentions` の「自分宛てか」と同じ理由で、受け取る人ごとの値を入れられない。
REST（履歴の取得と、リアクションの `PUT` / `DELETE` の応答）にだけ `me` が入る。

#### 添付ファイルだけの削除（`attachments`。ADR 0045）

メッセージを残したまま添付を 1 件消したときも、**専用のイベントを作らない**。リアクションと同じく
そのメッセージの `change_seq` が 1 つ進み、`attachments` からその 1 件が消えた `message.updated` が届く
（再接続の差分（`after_change_seq`）にもそのまま乗る）。`seq` / `user_seq` / `last_message_at` は進まないので、
未読数もサイドバーの並びも動かない。

最後の 1 件を消して本文も空になったメッセージは、そのまま消える。届くのは `message.deleted`（tombstone）で、
メッセージを削除したときと区別しない（ADR 0045 決定 8）。消えた添付の跡は残さない。
クライアントは、`me` の無い更新では手元の `me` をそのまま保てばよい。`me` が変わるのは自分が押したときだけで、
そのときは `PUT` / `DELETE` の応答が `me` 付きで返るため。

`seq` / `user_seq` / ルームの `last_message_at` は**進まない**ので、未読数にもサイドバーの並びにも影響しない。
同じリアクションを 2 回付けた（再送・二重クリック）ときは行が増えないので、`change_seq` も進まず、イベントも届かない。

スレッドの返信（ADR 0036）も `message.created` として同じルームの購読者に届く。`thread_root_id` に親の ID、`thread_seq` にスレッドの中の番号が入る。
返信はチャンネルのタイムラインに出さない。`seq` と `change_seq` はルームのものを使うので、同期（下記）はチャンネルと同じ 1 本で済む。
例外は「チャンネルにも投稿する」を付けた返信（ADR 0039）で、`also_in_channel` が true になり、チャンネルのタイムラインにも並べる。
クライアントは `thread_root_id` があればスレッドへ、`thread_root_id` がないか `also_in_channel` が true ならチャンネルへ振り分ける（両方に入ることがある）。
`also_in_channel` は送信の後に変わらない。
親のメッセージは、返信が 1 件以上ついたことがあれば `thread`（`reply_count`・`last_thread_seq`・`last_reply_at`）を持つ。
返信の送信と削除では、親の `change_seq` も進む（返信数の変化は `after_change_seq` の差分取得で揃う）。
そのときは、返信の `message.created`（または `message.deleted`）の後に、親の `message.updated` が続けて届く（親の `change_seq` は返信の次の番号）。

#### システムメッセージ（`kind: "system"`）

参加・退出・作成・名前の変更は、`message.created` として届くログの行でもある（ADR 0033）。`body` は空で、文言はクライアントが作る。

```json
{
  "id": "01J8...", "room_id": "01J8...", "seq": 43, "change_seq": 58, "user_seq": 30,
  "kind": "system", "system": { "type": "room_renamed", "old_name": "雑談", "new_name": "雑談 改" },
  "sender": { "id": "01J8...", "handle": "miyuki", "display_name": "高橋 みゆき" },
  "body": "", "thread_root_id": null, "thread_seq": null, "also_in_channel": false, "thread": null, "attachments": [], "mentions": [], "created_at": "2026-09-19T01:00:00Z", "edited_at": null, "deleted_at": null
}
```

`type` は `room_created` / `member_joined` / `member_left` / `member_removed` / `room_renamed`。**sender はその行の主語**（参加した人、名前を変えた人）。DM には出ない。

#### `member.joined`

```json
{ "workspace_id": "01J8...", "room_id": "01J8...", "user": { "id": "01J8...", "handle": "naoki", "display_name": "佐藤 直樹" } }
```

`user.id` が自分なら、ルームを `GET /api/v1/rooms/{id}` で取得してサイドバーに加え、購読する。

#### `member.left`

```json
{ "workspace_id": "01J8...", "room_id": "01J8...", "user_id": "01J8..." }
```

#### `room.updated`

```json
{ "workspace_id": "01J8...", "room_id": "01J8...", "name": "デザインレビュー", "is_default": false }
```

#### `room.member_removed`

```json
{ "workspace_id": "01J8...", "room_id": "01J8...", "reason": "removed" }
```

- `reason`: `left`（自分で抜けた）/ `removed`（他人に外された、またはサーバーの再検証で読めなくなった）
- 届いた時点で、サーバーはその接続の購読を外している（読めなくなった場合）。public ルームは参加していなくても読めるので、購読が残ることがある。
- 画面: `chat/removed-from-channel.png`。非公開チャンネルの名前も「外された」ことも出さず、「アクセスできません」だけにする（ADR 0035）

#### `room.read`

```json
{ "workspace_id": "01J8...", "room_id": "01J8...", "last_read_seq": 42, "last_read_user_seq": 30, "unread_count": 0, "mention_count": 0 }
```

`last_read_user_seq` は既読位置に対応する `user_seq`。クライアントはこれで未読数を求め直す（ADR 0033）。
`mention_count` は既読を進めた後の、自分宛ての未読のメンションの数（ADR 0041）。別の端末のバッジもこれで揃う。

#### `thread.read`

```json
{ "workspace_id": "01J8...", "room_id": "01J8...", "thread_root_id": "01J8...", "last_read_thread_seq": 3, "unread_count": 0 }
```

スレッドの未読数は、親の `thread.last_thread_seq - last_read_thread_seq`（ADR 0036）。

#### `thread.followed`

```json
{ "workspace_id": "01J8...", "room_id": "01J8...", "thread_root_id": "01J8...", "last_read_thread_seq": 0 }
```

誰が参加するかはサーバーだけが決める（将来はメンションされた人も参加する）。受け取ったら、参加中のスレッドの一覧（`GET /api/v1/workspaces/{id}/threads`）と、ルーム一覧の `unread_thread_count` を取り直す。

#### `workspace.updated`

```json
{ "workspace_id": "01J8...", "name": "hibari 開発", "invite_policy": "admins_only" }
```

#### `workspace.member_removed`

```json
{ "workspace_id": "01J8...", "user_id": "01J8...", "reason": "removed" }
```

- `reason`: `left` / `removed`
- `user_id` が自分なら、そのワークスペースの購読（ワークスペースとルーム）はすべて外れている。画面: `chat/removed-from-workspace.png`

#### `workspace.role_changed`

```json
{ "workspace_id": "01J8...", "user_id": "01J8...", "role": "admin" }
```

#### `presence.changed`

```json
{ "user_id": "01J8...", "online": true }
```

初期値は REST で取る（`GET /api/v1/rooms/{id}/members` の `online`、ルームの `dm_peer.online`）。
同じユーザーが複数の端末（複数のサーバー）に接続していても、最初の接続で `true`、最後の切断で `false` を 1 回ずつ送る（ADR 0016）。

#### `typing.started`

```json
{ "workspace_id": "01J8...", "room_id": "01J8...", "thread_root_id": null, "user": { "id": "01J8...", "handle": "miyuki", "display_name": "高橋 みゆき" } }
```

受け取ってから 6 秒で表示を消す。`typing.stopped` はない。`thread_root_id` があればスレッドでの入力なので、チャンネルの入力中には出さない。

## close コード

| コード | 意味 | クライアントの動き |
|---|---|---|
| 1001 | サーバーの停止 | 指数バックオフ + ジッターで再接続し、同期する |
| 1008 | プロトコル違反 | 同上（クライアントのバグを疑う） |
| 1009 | フレームが大きすぎる | 同上 |
| 1011 | サーバーがイベントの配信の準備に失敗した（Redis の障害など） | 指数バックオフ + ジッターで再接続し、同期する |
| 1012 | サーバーの配信の経路が張り直され、イベントを取りこぼしたかもしれない（ADR 0016） | 同上 |
| 4000 | 送信が追いつかない | 再接続し、同期する |
| 4001 | セッションが失効した | 再接続しない。refresh を試み、失敗したらログイン画面へ |

サーバーは 30 秒ごとに WebSocket の ping を送り、応答がなければ最長 60 秒で切る（このときクライアントには 1006 に見える）。

## 同期（再接続の手順）

WebSocket の配信は落ちうるので、クライアントはルームごとに次の 2 つを持つ（ADR 0014）。

- `seq`: 表示の順序と未読の根拠
- `change_seq`: 同期のカーソル。受け取ったメッセージの `change_seq` と、履歴のレスポンスの `last_change_seq` の最大値

接続（再接続）したら、次の順に行う。**購読を先にする**。REST を先に読むと、読み終わってから購読するまでの変更を取りこぼす。

1. ticket を発行して接続する
2. 表示中のワークスペースと、サイドバーのルームを `subscribe` し、`ack` を待つ
3. ルーム一覧（未読数・最終メッセージ）を REST で取り直す
4. メッセージを表示・キャッシュしているルームごとに、`GET /api/v1/rooms/{id}/messages?after_change_seq=<change_seq>` を `has_more` が false になるまで呼ぶ
   - 受け取ったメッセージは `id` で上書きし、表示は `seq` で並べる
5. 開いているパネルのメンバー一覧（presence を含む）を REST で取り直す

接続中にメッセージのイベントを受け取ったら:

- `change_seq` がカーソル以下: すでに反映済み。無視してよい（`id` で上書きしても結果は同じ）
- カーソル + 1: 反映してカーソルを進める
- カーソル + 2 以上: 間のイベントを取りこぼした（または順序が入れ替わって届いた）。4 と同じ差分取得を行う

REST の送信のレスポンスと `message.created` は両方届く。`client_msg_id` と `id` で重複を除く（ADR 0004）。
