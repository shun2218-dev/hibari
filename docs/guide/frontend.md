# フロントエンドの構成

Web クライアントは `web/` の Next.js（App Router、TypeScript、Tailwind CSS）で作っている。
このページは、ファイルの置き場所とデータの流れをつかむための入口。細かい決まりは各 ADR にある。

## 全体の方針

- **Next.js は UI だけを持つ。** ビジネスロジックは Go のサーバーにあり、Web はその REST と WebSocket を呼ぶクライアントの 1 つにすぎない。Route Handler にロジックを書かない。
- **画面の正本は [画面仕様](../ui/README.md) のスクリーンショット。** そこにない画面や状態は発明しない。
- ページはルートグループで分ける。`app/(auth)/` はログインの前、`app/(app)/` はログインが必要な画面。ログインしているかの振り分けは、ブラウザで refresh の結果を見て行う（[ADR 0024](../adr/0024-web-session.md)）。
- ローカルでは、Next.js だけはコンテナに入れずホストで起動する。macOS の bind mount が遅く、`node_modules` に直撃するため。

## ディレクトリ

新しいファイルは、上から順に当てはまったところに置く（[ADR 0060](../adr/0060-web-directory-layout.md)。`web/CLAUDE.md` にも同じ規則がある）。

| 順 | 条件 | 置き場所 |
|---|---|---|
| 1 | `react` を import しない | `lib/`（ドメインごとに `lib/chat/store/` などへ） |
| 2 | フック（`use` で始まる関数） | `hooks/`（ドメインのものは `hooks/chat/`・`hooks/auth/`） |
| 3 | Context を作って Provider で配る | `providers/` |
| 4 | props だけで描ける | `components/` |
| 5 | ストアやルーターにつないで描く | 使うルートの `app/…/_components/` |

- **`components/` は「props だけで描く」の境界を、ディレクトリの形で保つ。** ストアに依存する部品は入れない。
- 親の階層へ上がる import（`../`）は書かず、`@/` から書く（ESLint が止める）。`index.ts` で束ね直さない。
- 行数だけを理由にファイルを分けない。役割が混ざっているときに分ける。テストは実装の隣に置く。

## データ層

`lib/` の下に、React に依存しない形で置く。画面はフックを通してこれを読む。

### セッションと refresh

- **Access Token はメモリにだけ持つ。** localStorage には置かない。画面に見せるのは `loading` / `signed_out` / `signed_in` とユーザーだけ（`lib/auth/session/`）。
- Refresh Token は httpOnly Cookie で、JavaScript からは読めない。Cookie を使うのは Web だけの実装の詳細で、サーバーの API はトークンを前提にしている（[ADR 0010](../adr/0010-auth-api-details.md)）。
- API はすべて `session.request()` を通す。期限が近ければ呼ぶ前に refresh し、401 なら 1 回だけ refresh して呼び直す。
- **refresh はタブをまたいで 1 本にする（single-flight）。** Refresh Token はローテーションするので、複数のタブが同時に同じトークンで refresh すると再利用として検知されるため。Web Locks API で直列にする（`lib/auth/single-flight.ts`。[ADR 0024](../adr/0024-web-session.md)）。

### API の型

- **REST と WebSocket の型は、Go の型から生成する**（`lib/api/types.gen.ts`。[ADR 0022](../adr/0022-typescript-types-from-go.md)）。手で書き写さないので、サーバーとずれない。
- 生成は `make ts-types`。生成結果とファイルが違えば、Go のテストが落ちる。
- WebSocket のイベントは、`type` で `data` の型が決まる union として出る。

### ストア

- **チャットの状態は、自作のストア（`lib/chat/store/`）が持つ。** `useSyncExternalStore` で購読し、コンポーネントは自分が見ている部分が変わったときだけ描き直される。
- 中身はワークスペース・ルーム・タイムライン・送信・スレッドなどのスライスに分けてあり、`chat-store.ts` はそれを組み立てるだけ。
- **REST で取った状態に、WebSocket のイベントを重ねる。** 並べる順は常に `seq` で、`created_at` では並べない。

### リアルタイムと再接続

- `lib/chat/realtime/` が WebSocket の接続を 1 本持ち、切れたらつなぎ直す。つなぐたびに ws-ticket を発行する（[ADR 0026](../adr/0026-web-realtime-client.md)）。
- 切れたら指数バックオフとジッターで待ってつなぎ直す。セッションが失効した（close コード 4001）ときは、refresh を試して失敗すればログインの画面に移る。
- **WebSocket だけでは完結させない。** 配信は落ちうるので、再接続したら次の順に揃える（手順の正本は [WebSocket イベント](../events.md) の「同期」）。
  1. 購読して、ack を待つ（REST を先に読むと、その間の変更を取りこぼす）
  2. ルームの一覧を取り直す
  3. 手元にタイムラインがあるルームは、`after_change_seq` で差分を取る
- 接続中も、届いたイベントの `change_seq` が飛んでいたら、取りこぼしとみなして同じ差分を取る（[ADR 0014](../adr/0014-message-change-seq.md)）。

### 送信（楽観的な表示）

- **送った直後から、確定を待たずにタイムラインに出す。** 確定していない自分のメッセージは、確定したメッセージとは別の `outgoing` に持つ（[ADR 0027](../adr/0027-web-sending-messages.md)）。
- `client_msg_id` はクライアントが作る ULID。送信の応答と `message.created` の先に届いた方で確定させ、重複は ID で除く。
- **同じルームの送信は、入力した順に 1 件ずつ送る。** 並行に送ると、サーバーの採番の順が入力の順と入れ替わることがあるため。
- 応答がエラーか 10 秒来なければ失敗にする。再送は同じ `client_msg_id` で送るので、実は届いていても二重にならない。

## コンポーネントと Storybook

- **`components/` の部品は API もルーターも知らず、props だけで描く**（[ADR 0018](../adr/0018-web-presentational-components.md)）。
  - props は API のレスポンスではなく表示用の型で受け取る。時刻などの文言は整形済みの文字列で受け取る。
  - 操作できるかどうかは、判定の結果として受け取る。部品の中でロールから可否を導かない（認可はサーバーの authz が正）。
- 部品は Storybook で見られる。公開先は [ui.hibari-chat.com](https://ui.hibari-chat.com)。
- **画面の story は `docs/ui/screenshots/` の PNG と 1 対 1 に対応させる。** story の id を PNG のパスにしてあり、ずれると検査のテストが落ちる（[ADR 0047](../adr/0047-storybook.md)）。
- `components/ui/` の共通部品には必ず story を作る。どの部品に作るかの規則は `web/CLAUDE.md` にある。
- テストは Vitest と React Testing Library。表示の部品は、送信中・失敗・削除済みのような状態ごとの見た目を確かめる。

## デザイントークン

- **色・余白・角丸・文字の大きさの正本は `web/app/globals.css` の CSS 変数だけ。** 部品に生の値を書かず、Tailwind の任意値（`p-[13px]` など）も使わない。検査のテストが止める。
- Tailwind の既定のテーマは捨ててあるので、`text-red-500` や `rounded-xl` は存在しない。トークンから生成されたものだけで組む。
- **緑（primary）は操作できるもの、琥珀（attention）はいま起きていること。** 未読のバッジ・入力中・再接続中のバナーに緑を使わず、琥珀の要素を押せるようにしない。
- ダークテーマは `data-theme="dark"` で切り替え、OS の設定には追従しない。
- どのトークンをいつ使うかは [デザイントークン](../ui/tokens.md) にある。新しいトークンは、足す前にオーナーに確認する。

## 入力欄

- **メッセージの入力欄のリッチテキストは Lexical で作る**（[ADR 0052](../adr/0052-rich-text-composer.md)）。
- **Lexical を import するのは `components/chat/editor/` の中だけ。** 版は固定する（1.0 の前で、マイナー版でも破壊的な変更があるため）。版を上げるときに直す範囲をこのディレクトリに限る。
- 入力欄の値は、サーバーへ送る形のテキストにする。本文を読み込むときは表示と同じ解釈を使うので、表示と編集で書式の見え方がずれない（[ADR 0051](../adr/0051-message-formatting.md)）。
