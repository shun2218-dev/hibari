# 0002. メッセージの順序に seq を使い、timestamp を使わない

- 状態: 採用
- 日付: 2026-09-13

## 背景

チャットではメッセージの順序が全クライアントで一致している必要がある。さらに、再接続したクライアントが「どこまで受け取ったか」を正確に表現し、差分を取得できる必要がある（ADR 0004）。

## 決定

- ルームごとに **1 から単調増加し、欠番のない整数 `seq`** を採番し、それを順序の唯一の根拠にする。
- `messages.created_at` は表示専用とし、ソートにもカーソルにも使わない。
- 採番カウンタは `rooms.last_message_seq`（初期値 0）の 1 列だけにする。
  採番すると、その値がそのまま「ルームの最新 seq」になる。
- 制約: `UNIQUE(room_id, seq)`。インデックス: `(room_id, seq DESC)`。
- 未読数は `rooms.last_message_seq - room_members.last_read_seq` で O(1) で求める。

## 理由

- **時計は信用できない**: 複数のサーバーインスタンスの時計はずれる。同じマイクロ秒に 2 件が作られることもある。`created_at` の順序は「だいたい正しい」止まり。
- **カーソルとして使える**: 「seq 100 まで受け取った」は曖昧さのない状態で、`after_seq=100` がそのまま差分取得のカーソルになる。timestamp をカーソルにすると、同時刻や時計の逆行で取りこぼしや重複が起きる。
- **欠番の検出**: 欠番がないことが保証されていれば、クライアントは「seq 102 の次に 104 が来た」ことから取りこぼしを検出できる。
- **ULID の順序では足りない**: ULID もミリ秒単位の時刻に依存し、インスタンスをまたぐと単調性が保証されない。

## 検討した代替案

- **`created_at` + `id` の複合ソート**: 順序は決まるが、「後から前に割り込むメッセージ」が発生しうるので、差分取得のカーソルとして安全ではない。
- **Postgres の SEQUENCE（全ルーム共通）**: 一意で単調ではあるが、ルーム単位では欠番だらけになり、取りこぼしの検出に使えない。ロールバックでも欠番が出る。
- **`next_seq` と `last_message_seq` の 2 列**: 論理削除でも seq は残るので、常に `last_message_seq = next_seq - 1` になり冗長。off-by-one の温床にもなるので 1 列にした。
- **`SELECT max(seq) + 1`**: ロックなしでは並行送信で重複する。

## 結果（トレードオフ）

- 同じルームへの送信は、`rooms` の行ロックで直列化される。1 ルームあたりの書き込みスループットに上限ができるが、チャットの 1 ルームへの書き込み頻度なら問題にならない。
- 冪等な再送（ADR 0004）で seq を消費してはいけない。欠番を作らない書き方を Phase 3b で検証する。
- 未読数には削除済みメッセージも含まれる。O(1) で求めるための許容した近似とする。

## 追記

### 2026-09-13 採番方式の確定（Phase 1）

送信と同じトランザクションの中で、次の 1 文で採番する。

```sql
UPDATE rooms
   SET last_message_seq = last_message_seq + 1,
       last_message_at  = $now
 WHERE id = $room_id
RETURNING last_message_seq;
```

- **直列化の仕組み**: UPDATE が rooms の行に `FOR NO KEY UPDATE` のロックを取るので、同じルームへの並行送信は、先行するトランザクションのコミットかロールバックまで待たされる。待たされた側は更新後の値を読み直してから +1 する（READ COMMITTED の再評価）。そのため `SELECT ... FOR UPDATE` を別に発行する必要はない。
- **ロールバックで欠番にならない**: カウンタの更新もトランザクションに含まれるので、INSERT が失敗してロールバックすれば採番も取り消される。全ルーム共通の SEQUENCE との決定的な違い。
- **messages の FK とは衝突しない**: messages の INSERT は FK の検査で rooms の行に `FOR KEY SHARE` を取る。これは自分の `FOR NO KEY UPDATE` とも、他のトランザクションの `FOR NO KEY UPDATE` とも競合しない（キー列を変えない UPDATE だから）。
- **ロックを持つ時間を短くする**: UPDATE から COMMIT までの間に、外部への I/O（Redis への publish、ストレージへの HEAD など）を挟まない。配信はコミットの後に行う（ADR 0004）。
- **根拠のテスト**: `db/schema_test.go` の `TestSeqAllocationConcurrent`。50 並行の送信（うち 3 件に 1 件はロールバック）で、seq が 1 から欠番も重複もなく並び、`last_message_seq` がコミットされた件数と一致することを確かめている。

検討した代替案

- **`pg_advisory_xact_lock(hash(room_id))` + `SELECT max(seq) + 1`**: 行ロックと同じ直列化ができるが、ハッシュの衝突で無関係なルーム同士が待ち合う。カウンタ列（ADR の決定）があるなら、行ロックの方が単純。
- **別テーブル `room_seq_counters`**: rooms の行を、名前の変更などの他の更新とロックで取り合わなくなる。ただしルームの更新頻度は送信よりはるかに低いので、テーブルを増やすほどの効果がない。
- **`rooms_workspace_id_last_message_at_idx` の影響**: `last_message_at` はインデックス列なので、この UPDATE は HOT 更新にならず、送信のたびに rooms のインデックスにも書き込みが発生する。一覧のソートのための非正規化とのトレードオフとして許容する。

### 2026-09-13 インデックスの形（Phase 1）

`UNIQUE(room_id, seq)` と `INDEX(room_id, seq DESC)` は、`CREATE UNIQUE INDEX messages_room_id_seq_idx ON messages (room_id, seq DESC)` の 1 本で兼ねる。B-tree は逆方向にも走査できるので、昇順と降順を 2 本張っても書き込みが遅くなるだけ。UNIQUE 制約（`CONSTRAINT ... UNIQUE`）は降順を指定できないので、UNIQUE インデックスとして作る。
