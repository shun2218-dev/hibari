# 0022. Go の JSON の型から TypeScript の型を生成する

- 状態: 採用
- 日付: 2026-09-16

## 背景

Phase 6-2 で、Next.js のデータ層が REST のレスポンスと WebSocket のイベントを扱い始める。ロードマップは「Go 側のイベント定義から TypeScript の型を生成する（方式は 6-2 で提案する）」としていた。

- JSON の形を決めているのは `internal/httpx` の非公開の struct。ハンドラの中に書いた無名の struct も多かった（一覧のレスポンス、イベントの data）。
- 列挙値（ロール、ルームの種類、招待の状態など）は `authz` / `chat` に名前付きの string 型の const として定義されているが、レスポンスの struct では `string` に変換していた。
- 手で書いた TypeScript の型は、Go の変更に気づけずに黙ってずれる。

## 決定

- **`internal/httpx/tsgen_test.go`（パッケージ内のテスト）が、登録した struct を reflect で読んで `web/lib/api/types.gen.ts` を生成する。**
  - `make ts-types`（`go test ./internal/httpx -run TestTypeScriptTypes -update`）で書き直す。
  - `-update` なしでは、生成結果とファイルが 1 バイトでも違えば失敗する。`make test` と CI の `go test ./...` がそのまま検査になる。
- 無名の struct には名前を付ける（`messageListResponse`、`memberJoinedData` など）。JSON の形は変えない。
- 列挙値のフィールドは、レスポンスの struct でも名前付きの型（`authz.Role` など）のまま持つ。生成器はそれを TypeScript の union にする。
  - リクエストの struct は、値の検証をドメインが行うので `string` のまま受け、生成器の上書き（`tsFieldTypes`）で union にする。
  - Problem の type（`problemType`）、ack の error（`ackError`）、クライアントのメッセージの type（`clientMessageType`）も名前付きの型の const にする。
- 変換の規則
  - ポインタは `T | null`、`omitempty` は `field?:`。リクエストではポインタを「省略してよい」として `field?: T | null`。
  - 埋め込んだ struct は展開する。`time.Time` は `string`、数値は `number`。
  - スライスと map は `T[]` / `Record<string, T>`（ハンドラが `make` で作り、`null` にしない前提）。
  - Go のフィールドのコメントを JSDoc として出す。
- イベントは `ServerEvent`（`type` で `data` が決まる discriminated union）として出す。`data` の型は、生成器が本番の `eventData` に chat のデータを渡して決める。
- 3 つの検査で登録の漏れを防ぐ。
  1. 列挙値: 登録した値の集合が、Go のソースにあるその型の const の集合と一致する（`go/parser` で読む）。
  2. イベント: `chat.EventType` の const がすべて登録されている。
  3. struct: `internal/httpx` の JSON のタグを持つ struct が、すべて登録されているか、意図して外されている（`tsSkipped`）。

## 理由

- **テストにする理由**: 非公開の型を reflect で読めるので、型を公開するためだけにパッケージを分けなくてよい。生成のし忘れが、別の CI の手順を足さなくても `go test` で落ちる。
- **reflect で読む理由**: `encoding/json` と同じ情報（タグ、埋め込み、ポインタ）から作るので、生成した型と実際の JSON がずれない。ソースを解析する方式では、エイリアスや埋め込みを自分で解決する必要がある。
- **列挙値を型のまま持つ理由**: `string` に変換すると、生成器がどの値を取りうるかを知る手がかりが消える。const の集合との照合で、値を足したときの登録漏れも落とせる。
- **依存を増やさない理由**: 必要な規則は 200 行ほどで書け、JSON の形とクライアントの型の対応を自分で説明できる（学ぶという目的）。

## 検討した代替案

- **tygo などのツールを `tools/go.mod` に足す**: 定番だが、公開の型しか読めないので、レスポンスの型を別のパッケージに移して公開する必要がある。`omitempty` と null の扱いやイベントの union は、結局設定か後処理が要る。
- **TypeScript は手で書き、契約テストで守る**（Go のテストが実際の JSON を書き出し、Vitest が照合する）: 生成器は要らないが、型を 2 回書くうえ、照合できるのは書き出したサンプルに現れたフィールドだけになる。
- **OpenAPI を書いて両側を生成する**: REST は網羅できるが、WebSocket のイベントは対象外で、定義が Go のコードと別にもう 1 つ増える。

## 結果（トレードオフ）

- レスポンスの struct を足したら `tsDecls` に登録し、`make ts-types` を実行する必要がある（忘れると `go test` が落ちる）。
- `null` にならないはずのスライスや map を、ハンドラが `nil` のまま返すと型と食い違う（`encoding/json` の v1 は `nil` を `null` にする）。生成器は検査しない。
  JSON の処理を `encoding/json/v2`（`nil` のスライスを `[]`、`nil` の map を `{}` にする）に移し、登録した型をゼロ値で書き出して `null` が出ないことを確かめるテストを足して解消する（別の PR）。
- テストが `web/` のファイルを読み書きするので、`internal/httpx` のテストはリポジトリ全体がそろった状態で実行する必要がある（compose の `/src` と CI はそうなっている）。
- エンドポイントの URL やメソッドと、リクエスト・レスポンスの型の対応は生成しない。データ層の API クライアントに手で書く。
