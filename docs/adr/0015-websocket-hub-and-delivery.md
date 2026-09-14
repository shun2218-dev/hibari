# 0015. WebSocket の Hub・購読・配信（Phase 4）

- 状態: 採用
- 日付: 2026-09-14

## 背景

Phase 4 では、単一インスタンスのインメモリの Hub で WebSocket の配信を実装する。着手時点で、ロードマップと ADR 0004 / 0007 が決めていない点があった。

- 購読の単位。画面（`chat/default.png`）のサイドバーは、開いていないルームの未読数・最終メッセージ、DM 相手の presence も表示する
- ロードマップのイベントの一覧だけでは表現できない状態
  - 相手が DM を作った・private ルームに追加された・招待で default ルームに入ったとき、本人のサイドバーにルームを出す手段がない
  - 別の端末で既読にしたとき、未読のバッジを揃える手段がない
  - presence の初期値（接続した時点で誰がオンラインか）を得る手段がない
- ADR 0007 が「Phase 4 で間隔を決める」とした、接続中のセッションと権限の定期的な再検証
- パッケージの置き場所と、ユースケースから配信を呼ぶ形（CLAUDE.md ルール 6）
- 1 つの接続に書き込む goroutine を 1 本に限る（CLAUDE.md）ときの、ping / close / ack の書き方

イベントのスキーマそのものは `docs/events.md` を正本にする。

## 決定

### 接続
- `POST /api/v1/ws/ticket`（Access Token が必要）で ws-ticket を発行する（ADR 0007）。32 バイトの乱数を base64url にした 43 文字。Redis に `authn:wsticket:{ticket}` → `{user_id, sid}` を TTL 30 秒で保存する。
- `GET /api/v1/ws?ticket=...` でアップグレードする。**アップグレードの前に** ticket を GETDEL で消費し、sid のセッションがまだ有効かを確かめる（ADR 0007 の「ws-ticket の消費時の検証」）。どれかに失敗したら、理由を区別せずに 401 `ws-ticket-invalid` を返す。
- セッションの有効性は `authn.SessionChecker` インターフェースで問い合わせる。実装は auth（`refresh_tokens` の family に未失効・期限内の行があるか）で、main で配線する。authn も chat も auth を import しない（ADR 0001）。
- Origin は `APP_BASE_URL` のホストだけを許す（`coder/websocket` の `OriginPatterns`）。ticket がなければ接続できないので CSRF の心配はないが、第三者のページに接続を張らせない。Origin ヘッダのないクライアント（ネイティブアプリ）は許す。
- ticket はクエリ文字列に載るが、アクセスログはクエリを出さない（`withAccessLog`）。

### 購読の単位: ワークスペースとルーム
- `subscribe` / `unsubscribe` は `room_id` か `workspace_id` のどちらか 1 つを取る。
  - ルーム: `message.*` / `member.joined` / `member.left` / `room.updated` / `typing.started`
  - ワークスペース: `workspace.updated` / `workspace.member_removed` / `workspace.role_changed` / `presence.changed`（と public ルームの `room.updated`）
- クライアントは、表示中のワークスペースと、サイドバーに出すルーム（参加中のルームと閲覧中の public ルーム）を購読する。
- **本人宛てのイベント**（`room.member_removed` / `room.read` / 本人の `member.joined` / 本人の `workspace.member_removed` / `workspace.role_changed`）は、購読していなくてもそのユーザーのすべての接続に届ける。
- 1 つのイベントが複数の経路で同じ接続に当たっても、1 回だけ送る。
- 購読のたびに authz を実行する（ルームは `CanReadRoom`、ワークスペースはメンバーであること）。読めなければ存在を明かさないよう `not_found` にする（ADR 0011）。
- 1 つの接続の購読は 500 件までにする。

### 追加したイベント（ロードマップの一覧との差分）
- `room.read`: 既読位置を更新したら、本人のすべての接続に `last_read_seq` と `unread_count` を送る。
- `member.joined` を、ルームの購読者に加えて**参加した本人にも**送る。本人はそれを見てルームを取得し、サイドバーに出して購読する。ルームの作成（作成者）、DM の作成（入った 2 人）、private への追加、public への参加、招待の受け入れ（default ルーム）のすべてで送る。
- presence の初期値は REST で返す。`GET /rooms/{id}/members` の各メンバーと、ルームの `dm_peer` に `online` を加える（Redis の MGET）。WebSocket の `presence.changed` は変化だけを送る。クライアントは購読してから REST を読む（逆だと、その間の変化を取りこぼす）。

### 配信の抽象（CLAUDE.md ルール 6）
- chat に `Delivery` インターフェース（`Deliver(ctx, Event)`）を置く。ユースケースは**コミットの後に**イベントを渡すだけで、WebSocket も接続も知らない。
- `Event` は「種類・宛先（ルーム / ワークスペース / ユーザー）・権限が変わったユーザー・データ（ドメインの型）」を持つ。宛先を接続に解決するのは `Delivery` の実装（Phase 4 は Hub、Phase 5 は Redis、Phase 7 以降は Push）。
- `Deliver` はエラーを返さない。コミット済みの変更を配信の失敗で取り消せないので、実装がログに残し、クライアントは change_seq の欠番と REST の差分取得で回復する（ADR 0004 / 0014）。
- JSON の形は WebSocket の層（`internal/httpx`）が決める。メッセージは REST と同じ形にするため、同じレスポンスの型を使う。

### パッケージ
| パッケージ | 役割 |
|---|---|
| `internal/chat` | `Delivery` と `Event`、各ユースケースからのイベントの発行、購読の authz（`SubscriptionAuthorizer`） |
| `internal/chat/realtime` | Hub: 接続の登録、購読の管理、宛先の解決、権限の再検証、presence / typing、失効による切断 |
| `internal/chat/presence` | presence と typing の Redis の読み書き（TTL 付き。CLAUDE.md ルール 5） |
| `internal/httpx` | ticket の API、アップグレード、接続ごとの読み書きの goroutine、JSON の形 |
| `internal/platform/authn` | ws-ticket の発行と消費、`SessionChecker` |

- Hub は接続を `Conn` インターフェース（`Send` と `Close`）として扱う。WebSocket のライブラリにも JSON にも依存しないので、ネットワークなしでテストできる。
- `SubscriptionAuthorizer` は DB だけを持つ型にし、`Delivery` を持つ `chat.Service` と分ける。Hub が authz を、Service が Hub を必要とするので、1 つの型にすると依存が循環する。

### 接続ごとの goroutine（書き込みは 1 本だけ）
- 読み取り: HTTP のハンドラの goroutine がそのまま読み続ける。`subscribe` などの処理（DB の authz を含む）もここで行い、ack は送信キューに入れる。
- 書き込み: 1 本の goroutine だけが接続に書く。送信キュー（64 件の buffered channel）のイベントと ack、30 秒ごとの Ping、切断時の close フレームをすべてここで書く。
  - Ping は pong を 30 秒まで待つ。待っている間は書き込みが止まるので、応答のないクライアントは最長で 60 秒後に切れる。
  - 1 回の書き込みは 10 秒で打ち切る。
  - ライブラリ（`coder/websocket`）が相手の ping に返す pong だけは、ライブラリが読み取りの中で書く。アプリケーションのデータと close は書き込みの goroutine だけが書く。
- **送信キューが一杯なら、待たずに接続を切る**（close コード 4000）。遅いクライアントのせいで、配信する側（リクエストの goroutine）を止めないため。クライアントは再接続して差分を取る。
- Hub からの切断（`Close`）は理由を記録して context をキャンセルするだけで、close フレームは書き込みの goroutine が書く。
- 読み取りが終わったら、context をキャンセルし、書き込みの goroutine の終了を待ってから Hub から登録を外す（defer）。
- サーバーの停止時は、`http.Server.Shutdown` がアップグレード済みの接続を扱わないので、Hub がすべての接続を 1001 で閉じ、登録が外れるのを待つ。

### 権限の変更の反映（CLAUDE.md ルール 8）
- 権限に関わるイベント（キック・退出・ルームから外す・ロールの変更）は、`Event` に「権限が変わったユーザーとワークスペース」を載せる。
- Hub は**イベントを送る前に**、そのユーザーの接続のうち該当するワークスペースの購読（ワークスペースとそのルーム）を DB で再検証し、読めなくなったものを外す。ロールを見て「外すべきか」を Hub が判断せず、authz の結果だけに従う。
- 購読の authz と権限の変更が並行したとき、「authz は変更の前の DB を読んで通ったが、購読を登録したのは再検証の後」になりうる。Hub はユーザーごとに再検証の回数（epoch）を持ち、authz の前後で epoch が変わっていたら authz をやり直す。
- 残る隙間: キックのコミットより後にコミットされたメッセージのイベントが、キックのイベントより先に Hub に届くと、外されたユーザーに 1 件届きうる（配信は goroutine をまたぐので、コミットの順に並ばない）。ミリ秒の窓で、本人が読めていた時点までに送られた内容と区別できないので受け入れる。

### 定期的な再検証（ADR 0007）
- **5 分ごとに**、すべての接続について次を確かめる。
  - sid のセッションがまだ有効か（`SessionChecker`）。無効なら close コード 4001 で切る
  - 購読しているワークスペースとルームを、まだ読めるか。読めなければ購読を外し、`workspace.member_removed` / `room.member_removed`（reason は `removed`）を送る
- 失効イベント（`auth:revoked`）を受けたら、該当する sid（またはユーザーのすべて）の接続を 4001 で即座に切る。定期の再検証は、そのイベントを取りこぼしたとき（Redis の再接続中など）の保険。
- 5 分にするのは、Access Token の TTL（15 分）より短く、接続数 × 数本のクエリが DB の負荷として目立たない間隔だから。

### presence / typing（CLAUDE.md ルール 5）
- presence: ユーザーの接続が 0 → 1 本になったら `presence:{userID}` を TTL 60 秒で SET し、そのユーザーが所属する全ワークスペースに `presence.changed`（online）を送る。1 → 0 本になったら DEL して offline を送る。接続中は Hub が 30 秒ごとに TTL を延ばす。
  - プロセスが落ちると offline のイベントは出ないが、TTL で 60 秒後に REST の `online` は false になる。
  - 接続数は Hub が数えるので、複数のインスタンスで同じユーザーが接続すると壊れる。Phase 5 で見直す。
- typing: `typing {room_id}` を受けたら、`typing:{roomID}:{userID}` を **SET NX EX 5** する。新しく SET できたときだけ、投稿できるかを DB で確かめてから `typing.started` を送る（送信者の接続には送らない）。SET できなければ何もしない。
  - 入力し続けるクライアントが 1 秒ごとに送っても、配信と DB の問い合わせは 5 秒に 1 回になる。クライアントは受け取ってから 6 秒で表示を消す（`typing.stopped` は送らない）。
  - typing を送れるのは、そのルームを購読している接続だけにする。購読していないルームの ID を大量に送られても、Redis のキーと DB の問い合わせが増えないように。

### close コード
| コード | 意味 | クライアントの動き |
|---|---|---|
| 1001 | サーバーの停止 | バックオフして再接続し、差分を取る |
| 1008 | プロトコル違反（テキスト以外のフレームなど） | 実装のバグ。再接続する |
| 1009 | メッセージが大きすぎる（4 KiB 超） | 同上 |
| 4000 | 送信キューが一杯（遅いクライアント） | 再接続し、差分を取る |
| 4001 | セッションが失効した | 再接続しない。refresh（失敗すればログイン画面） |

## 理由

- **ワークスペースの購読を足す理由**: presence とワークスペースのイベントは、特定のルームではなくワークスペース全体に属する。ルームだけで表現すると、参加している全ルームに同じイベントを配り、接続ごとに重複を除く必要がある。
- **本人宛てを購読なしで届ける理由**: 「自分がルームに追加された」は、まだ購読していないルームのイベントなので、購読の仕組みでは届けられない。キックも、購読を外した後に届けるので、購読に頼れない。
- **再検証を Hub が DB で行う理由**: イベントのデータから「どの購読を外すか」を Hub が計算すると、authz の判断が Hub に漏れる（CLAUDE.md ルール 9）。DB を読み直して authz に聞けば、判定は 1 箇所のまま。
- **遅いクライアントを切る理由**: 待つと、1 本の遅い接続がルーム全体への配信（送信 API のレスポンス）を遅らせる。配信は落ちてよい前提（ADR 0004）なので、切って差分取得に任せる方が全体が健全。
- **typing に SET NX を使う理由**: クライアントの送信間隔に頼らずにサーバー側で配信を間引ける。TTL が切れるまで再送されないので、Redis の 1 往復だけで判定できる。

## 検討した代替案

- **ルームだけを購読する**: ロードマップの字面に合うが、presence とワークスペースのイベントの宛先が決まらない。
- **接続したら参加中の全ルームを自動で購読する**: クライアントは楽になるが、ワークスペースを切り替えるたびに不要なルームのイベントも流れ続け、閲覧中の public ルームは別に購読が要る。
- **Hub を 1 本の goroutine（アクターモデル）にする**: 状態を mutex なしで扱えるが、購読の authz（DB）の間 Hub 全体が止まるか、非同期の往復が増える。状態の変更は短い区間の mutex で足りる。
- **接続の寿命に上限（15 分）を設けて、定期の再検証の代わりにする**: DB への定期的な問い合わせは要らないが、全クライアントが 15 分ごとに再接続と差分取得を繰り返す。
- **ping を別の goroutine から送る**: 書き込みを止めずに済むが、「1 つの接続に書き込む goroutine は 1 本」の規則を破る。
- **presence の初期値を購読の ack に載せる**: REST が増えないが、メンバーの多いワークスペースでは ack が大きくなる。REST ならメンバー一覧のページングにそのまま乗る。

## 結果（トレードオフ）

- 同じユーザーが複数のインスタンスに接続する Phase 5 では、presence の接続数と、Hub が持つ対応表をインスタンスをまたいで扱う必要がある（`--scale server=2` で壊れることを確かめてから直す）。
- 権限の変更のイベントは、送信する前に DB を 1〜2 回読むので、キック・ロールの変更の API がその分遅くなる。
- ワークスペースに新しいメンバーが入ったこと・public ルームが作られたことはイベントにしていない。メンバー一覧や参加可能なルームの一覧は、画面を開いたときに REST で取り直す。
- クライアントからのメッセージには、回数制限をかけていない（購読の件数の上限と typing の間引きだけ）。

## 追記

### 2026-09-15 複数インスタンスでの配信と presence（Phase 5）

- `Delivery` の実装は Redis Pub/Sub（`RedisDelivery` と `Broker`）に替わり、Hub はそのインスタンスの接続にだけ届ける（`DeliverLocal`）。権限の変更の再検証は、そのユーザーの接続を持つインスタンスが、Redis から受け取ったときに行う（ADR 0016）。
- presence の接続数は、Hub のメモリではなく、Redis のハッシュ `presence:{userID}`（フィールドはインスタンスの ID、フィールドごとの TTL）で数える。presence.changed は、状態の変更と同じ Lua スクリプトの中で publish する（ADR 0016）。上の「presence / typing」の「接続数は Hub が数えるので…Phase 5 で見直す」は、これで解決した。
- close コードに 1011（配信の準備に失敗した）と 1012（配信の経路が張り直された）を加えた（`docs/events.md`）。
