# 0013. 添付ファイル API の詳細（Phase 3c）

- 状態: 採用
- 日付: 2026-09-14

## 背景

Phase 3c の着手時点で、ADR 0008 とロードマップが決めていない点、`docs/` と画面仕様が食い違う点があった。

- 画面（`chat/attachment/attachment-done.png`、`chat/timeline/messages-all-states.png`）はファイル名を表示するが、`attachments` にファイル名の列がない
- `attachments.status` は `pending / attached` の 2 つだけで、complete（HEAD による検証）が済んだかどうかを表せない
- 画像の `width / height` を誰がどう決めるか。サーバーはファイルの中身を経由しない（CLAUDE.md ルール 10）
- 画面には `.fig` の添付があるが、ロードマップは「MIME の許可リスト」としている
- メッセージを削除したときの添付の扱い（ロードマップは「削除対象にする」とだけ書いている）
- 署名付き URL の署名にホスト名が含まれるので、コンテナの中から見たストレージ（`minio:9000`）とブラウザから見たストレージ（`localhost:9000`）で URL が変わる

## 決定

### スキーマ（マイグレーション 00005、`docs/erd.mermaid`）
- `file_name text NOT NULL` を追加する。表示と、ダウンロード時の `Content-Disposition` に使う。**オブジェクトキーには入れない**（キーは `attachments/{room_id}/{attachment_id}`）。
- `status` を 4 つにする。

  | status | 意味 | `message_id` |
  |---|---|---|
  | `pending` | URL を発行した。まだ検証していない | NULL |
  | `uploaded` | complete で HEAD の結果を検証した。メッセージに付けられる | NULL |
  | `attached` | メッセージに付いている | あり |
  | `deleted` | メッセージが削除された。掃除ジョブが消す | あり |

- `CHECK ((status IN ('attached', 'deleted')) = (message_id IS NOT NULL))` に置き換える。
- 掃除ジョブ用に部分インデックス `attachments (created_at) WHERE status <> 'attached'` を張る。消す対象の件数だけに比例して走査する。

### 発行（`POST /api/v1/rooms/{id}/attachments`）
- 入力: `file_name`、`content_type`、`size_bytes`、画像なら任意で `width` / `height`。
- 権限: そのルームに**投稿できる**こと（`authz.CanUploadAttachment`。中身は `CanWriteRoom`）。アップロードは投稿の準備なので、読めるだけの人（参加していない public）には許さない。
- 検証

  | 項目 | 規則 |
  |---|---|
  | `file_name` | 空白だけなら `required`、255 文字（rune）を超えたら `too_long`、`/`・`\`・制御文字を含んだら `invalid_format` |
  | `content_type` | 省略は `required`。パラメータ付き（`; charset=...`）や大文字は `invalid_format`。許可リストになければ `invalid_value` |
  | `size_bytes` | 省略は `required`。1 未満か上限を超えたら `out_of_range` |
  | `width` / `height` | 片方だけなら、もう片方が `required`。`image/*` 以外で指定したら `invalid_value`。1〜65535 の外なら `out_of_range` |

- `pending` の行を作ってから、署名付き PUT URL を返す。TTL は 15 分。
- レスポンス: `attachment` と `upload`（`method`、`url`、`headers`、`expires_at`）。`headers` はクライアントが付けるべきヘッダーで、いまは `Content-Type` だけ。`Content-Length` と `Host` も署名に含まれるが、HTTP クライアントが URL と本文から自動で付けるので返さない（ブラウザの fetch は `Content-Length` を設定できない）。
- **サイズは「上限」ではなく「一致」で縛られる。** `Content-Length` を署名に含めると、申告と 1 バイトでも違う PUT はストレージが 403 で拒否する（MinIO で確認した）。クライアントは発行時に正確なサイズを申告する。

### 受け付けるファイルの種類
- 許可リストは設定値（`ATTACHMENT_ALLOWED_TYPES`）。既定値に `application/octet-stream` を含め、**原則すべてのファイルを添付できる**ようにする。種類の分からないファイル（`.fig` など）は、クライアントが `application/octet-stream` として申告する。
- ブラウザで開かせる（`Content-Disposition: inline`）のは、安全なラスタ画像 `image/png`、`image/jpeg`、`image/gif`、`image/webp` だけ。それ以外は GET URL で `attachment` にしてダウンロードさせる。SVG はスクリプトを含められるので画像として扱わない。
- サイズの上限は設定値（`ATTACHMENT_MAX_BYTES`、既定 25 MiB）。

### 画像の `width` / `height`
- **クライアントの申告値**をそのまま保存する。サーバーは範囲だけを検証し、中身と一致するかは確かめない。
- 用途は、画像を読み込む前にプレビューの枠を確保して表示が揺れないようにすることだけ。認可や課金などの判断には使わない。

### complete（`POST /api/v1/attachments/{id}/complete`）
- アップロードした本人だけが呼べる（`authz.CanCompleteAttachment`）。本人でなければ 404（存在を明かさない）。
- `pending` のときだけ HEAD で検証する。`uploaded` / `attached` なら何もせずに現在の状態を 200 で返す（冪等）。`deleted` なら 404。
- HEAD でオブジェクトがなければ 409 `attachment-not-uploaded`。サイズか Content-Type が申告と違えば、オブジェクトを消して 409 `attachment-mismatch`。署名がサイズと Content-Type を縛るので通常は起きないが、ストレージの実装に依存しないための最後の防御として残す。
- **HEAD はトランザクションの外で行う。** 検証の後に `UPDATE ... SET status = 'uploaded' WHERE id = $1 AND status = 'pending'` の 1 文で状態を進め、行が更新されなければ読み直す（並行した complete なら現在の状態を返し、掃除で消えていれば 404）。

### メッセージへの添付（`POST /rooms/{id}/messages` の `attachment_ids`）
- 1 メッセージに 10 個まで（超えたら `too_long`）。重複は `invalid_value`。
- 添付があれば本文は空でもよい（長さと制御文字の検証は残す）。編集では添付を変えられないので、本文を空にする編集は受け付けない。
- ADR 0012 の送信のトランザクションで、`INSERT messages` の後に次の 1 文で付ける。

  ```sql
  UPDATE attachments SET status = 'attached', message_id = $message_id
   WHERE id = ANY($ids) AND room_id = $room_id AND uploader_id = $actor AND status = 'uploaded'
  RETURNING id
  ```

  返った件数が `attachment_ids` の数と違えば、`attachment_ids: invalid_value` でトランザクションごとロールバックする（採番した seq も戻る）。**他人の添付、別のルームの添付、未検証の添付、使用済みの添付は、どれも同じ条件で弾かれる。**
- 同じ添付を 2 つの送信が同時に使おうとしても、2 本目は行ロックを待ってから `status = 'uploaded'` の条件を満たさなくなるので、付くのは 1 つだけ。
- 同じ `client_msg_id` の再送は、ADR 0012 のとおり既存のメッセージを返す。`attachment_ids` は比べない。
- ロック順は `room_members` → `rooms` → `attachments`。

### 閲覧（`GET /api/v1/attachments/{id}/url`）
- `attached` の添付だけ。ルームを読めること（`authz.CanViewAttachment`。中身は `CanReadRoom`）。それ以外（読めない、`pending` / `uploaded` / `deleted`）はすべて 404。
- TTL 5 分の署名付き GET URL を返す。`response-content-disposition`（ファイル名は RFC 2231 の形式で符号化）と `response-content-type` を署名に含める。
- メッセージのレスポンスに `attachments`（`id / file_name / content_type / size_bytes / width / height`）を含める。並びは発行順（id 順）で、`attachment_ids` の順ではない。URL は含めない。一覧を返すたびに署名するとレスポンスが重くなり、TTL が切れた URL がクライアントのキャッシュに残るため。
- 添付は、メッセージの一覧を読んだ後に `message_id = ANY(...)` の 1 文でまとめて読む（N+1 にしない）。

### メッセージの削除
- `DeleteMessage` のトランザクションで、そのメッセージの `attached` を `deleted` にする。ストレージのオブジェクトは消さない（ネットワーク呼び出しをトランザクションに入れない）。
- 削除済みのメッセージ（tombstone）には `attachments` を返さず、GET URL も 404 になる。削除の前に発行した GET URL は TTL（5 分）まで有効なまま残る。

### 掃除ジョブ
- 対象は「作成から 24 時間を過ぎた `pending` / `uploaded`」と「`deleted`」。
- 1 回の実行で、次を対象がなくなるまで繰り返す。
  1. `SELECT ... WHERE status <> 'attached' AND (status = 'deleted' OR created_at < $cutoff) ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`
  2. ストレージのオブジェクトを消す（S3 の DELETE は、オブジェクトがなくても成功する）
  3. 行を消してコミットする
- `SKIP LOCKED` で、複数台が同時に実行しても同じ行を取り合わない（Phase 5）。
- オブジェクトの削除に失敗したらロールバックし、次の実行でやり直す。オブジェクトを消した後にコミットが失敗しても、行が残るので次の実行でもう一度消す（冪等）。
- 時刻は `Clock` から取る。実行の間隔（10 分）は実時間の ticker で、`context` のキャンセルで止まる。
- 起動直後には実行せず、最初の実行は 1 間隔後にする。開発中は air がソースの変更のたびにサーバーを再起動するので、そのたびに走らせても意味がない。また、サーバーを起動する統合テスト（`cmd/server`）が、共有のテスト用 DB にあるほかのテストの添付を実時間の基準で消さないようにするため。

### ストレージの抽象（`internal/platform/storage`）
- 操作は `PresignPut` / `PresignGet` / `Head` / `Delete` の 4 つだけ（ADR 0008）。バケットの作成は持たない（本番のバケットはインフラの側で作る）。
- 設定は `S3_ENDPOINT`（サーバーが HEAD / DELETE に使う）と `S3_PUBLIC_ENDPOINT`（署名付き URL に使う。省略時は `S3_ENDPOINT`）を分ける。署名にホスト名が含まれるので、クライアントから到達できるホスト名で署名する必要がある。
- aws-sdk-go-v2 の既定のチェックサム（CRC32）は「必要なときだけ」にする。S3 互換のストレージ（R2 など）が対応していないことがあるため。
- 署名付き URL の有効期間は、SDK が実時間で計算する。ストレージは実時間で期限を判定するので、ここに `Clock` を使うと URL が使えなくなる。レスポンスの `expires_at` だけは `Clock` から計算する。
- ローカルのバケット（`hibari` と `hibari-test`）は compose の `minio-init` が作る。CI は MinIO のコンテナを起動してから `mc mb` で作る（GitHub Actions のサービスコンテナは起動コマンドを渡せないため）。

### エラー（RFC 9457 の `type`）

| type | status | 意味 |
|---|---|---|
| `attachment-not-uploaded` | 409 | complete の時点でオブジェクトがない |
| `attachment-mismatch` | 409 | オブジェクトのサイズか Content-Type が申告と違う |

## 理由

- **ファイル名をキーに入れない理由**: ファイル名には任意の文字が入り、キーのエスケープやパスの解釈の違い（`../` など）を持ち込む。キーは ID だけにして、ファイル名はダウンロード時の `Content-Disposition` で渡す。
- **`uploaded` を状態として持つ理由**: 検証済みかどうかを別の列（`uploaded_at`）で持つと、状態の判定が 2 列にまたがる。送信時に HEAD する案は、送信のトランザクションの中にネットワーク呼び出しが入る。
- **`deleted` を状態として持つ理由**: 状態を足さずに「`messages.deleted_at IS NOT NULL` と JOIN して探す」と、tombstone が増えるほど毎回の走査が重くなる。削除と同じトランザクションで印を付ければ、ジョブの走査は消す対象の件数だけで済む。
- **寸法を申告値にする理由**: 正確な値を得るにはサーバーがオブジェクトの先頭を読む必要があり、「サーバーは中身を経由しない」（ルール 10）に反する。表示の揺れを防ぐヒントとしては申告値で足りる。
- **原則すべての種類を許可する理由**: チャットで共有したいファイルの種類は予測できない（画面にも `.fig` がある）。危険なのは「ブラウザが中身を解釈すること」なので、inline で返す種類を絞り、それ以外はダウンロードさせることで防ぐ。バケットのドメインはアプリと別のオリジンでもある。
- **発行に投稿の権限を求める理由**: 読めるだけの人がストレージに書き込めると、容量を使うだけの操作ができてしまう。
- **GET URL をメッセージに含めない理由**: 上記（「閲覧」の節）。

## 検討した代替案

- **`uploaded_at` 列を追加する / complete を廃止して送信時に HEAD する**: 上記の理由で不採用。
- **complete でオブジェクトの先頭を Range GET して寸法を読む**: 上記の理由で不採用。
- **厳格な許可リスト（画像と PDF だけ）**: 画面仕様の `.fig` を添付できない。
- **削除時に JOIN で探す**: 上記の理由で不採用。
- **presigned POST のポリシーでサイズの上限を縛る**: R2 が presigned POST に対応していない（ADR 0008）。
- **掃除ジョブで行を先に「削除中」にしてからトランザクションの外でオブジェクトを消す**: 行ロックを持ったままネットワークを呼ばずに済むが、状態がもう 1 つ増える。1 回に消す件数を 100 に絞り、`SKIP LOCKED` で他の処理を止めないので、ロックを持ったまま消す方式で足りる。

## 結果（トレードオフ）

- 掃除ジョブは、オブジェクトを消している間（最大 100 件）、対象の行のロックを持つ。24 時間の境界ちょうどに、その添付を付けて送信すると、送信はジョブのコミットを待ってから `attachment_ids: invalid_value` で失敗する。
- 24 時間を過ぎた下書きの添付は消えるので、クライアントは送信の失敗を受けてアップロードし直す。
- ルームやワークスペースを物理削除する API はまだない。追加するときは、CASCADE で `attachments` の行だけが消えてオブジェクトが残らないよう、先に `deleted` にする処理が要る。
- 添付だけのメッセージは本文が空なので、ルーム一覧の `last_message.body` も空になる。サイドバーでの表示は画面仕様にないので、Phase 6 で Claude Design 側に追加する。
- ユーザーごとの発行回数や容量の制限はない。公開する前（Phase 7 以降）に見直す。
- ローカルの MinIO は S3 API の CORS をすべてのオリジンに許可している。R2 ではバケットに CORS の設定（PUT / GET と `Content-Type` ヘッダー）が必要になる。
