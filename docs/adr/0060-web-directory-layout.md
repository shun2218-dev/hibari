# 0060. web/ のディレクトリ構成（hooks と Provider を lib から出し、lib は React に依存しないものだけにする）

- 状態: 採用
- 日付: 2026-09-23

## 背景

Phase 6 の画面を 6.15 まで足してきた結果、`web/` の置き場所の基準が崩れている。

- `lib/` に性質の違うものが同じ階層で並んでいる。純粋関数（`lib/chat/format.ts`）、状態のストア（`lib/chat/store.ts`）、
  WebSocket の接続（`lib/chat/connection.ts`）、Context と Provider（`lib/chat/chat-provider.tsx`、`lib/auth/session-provider.tsx`）、
  カスタムフック（`lib/use-dismiss.ts`、`lib/chat/use-origin.ts`、`chat-provider.tsx` の `useChatState` など）。
  `lib/chat/` だけで 26 のファイルが平らに並び、「lib に置くのは何か」を名前から判断できない。
- `app/w/[workspaceId]/(chat)/` に、ルート（`page.tsx` / `layout.tsx`）と、ストアにつないだ画面の部品（`room-view.tsx`）と、
  フック（`message-actions.tsx` の `useMessageActions`、`profile.tsx` の `useOpenDm`）が区別なく並んでいる。
- 1 つのファイルが大きくなりすぎている。`lib/chat/store.ts`（2,801 行）、`lib/chat/views.ts`（970 行）、
  `components/chat/room-dialogs.tsx`（762 行）、`components/chat/message-item.tsx`（663 行）、`components/chat/editor/plugins.tsx`（589 行）、
  `stories/screens.tsx` と `stories/fixtures.ts`（約 1,000 行ずつ）。変更のたびに無関係な部分まで読むことになり、差分も追いにくい。
- import のパスは `@/*` のエイリアスが使える（`tsconfig.json`）が、相対パス（`../`）との使い分けに決まりがない。
  ファイルを動かすと、動かしたファイルの中の `../` と、それを指す側の両方を直すことになる。

このまま 6.16 以降を足すと、どこに置くかを毎回その場で決めることになる。React / Next.js で一般的な構成に揃え、
置き場所を機械的に決められるようにする。

## 決定

### 1. 最上位のディレクトリの役割

| ディレクトリ | 置くもの | 置かないもの |
|---|---|---|
| `app/` | ルート（`page.tsx` / `layout.tsx`）と、そのルートでしか使わない画面の部品（`_components/`） | フック、ロジック |
| `components/` | props だけで描く presentational コンポーネント（ADR 0018 のまま） | ストア・API・ルーターを知るもの |
| `hooks/` | カスタムフック（`use-*.ts`）すべて | コンポーネント |
| `providers/` | Context と Provider（`SessionProvider` / `ChatProvider`） | Context を読むフック（`hooks/` に置く） |
| `lib/` | React に依存しないもの（API クライアント、ストア、接続、純粋関数、ブラウザ API の薄い包み） | `react` を import するもの |
| `stories/` | Storybook の画面と固定データ（ADR 0047） | |
| `test/` | テストの補助（偽の API・ソケット、描画の補助） | |

判断の順序は次のとおり。

1. `react` を import しないなら `lib/`。
2. フック（名前が `use` で始まる関数）なら `hooks/`。
3. Context を作って Provider で配るなら `providers/`。
4. props だけで描けるなら `components/`。
5. ストアやルーターにつないで描くなら、使うルートの `app/…/_components/`。

### 2. `app/` の画面の部品は `_components/` に置く

- ストアにつないで描く部品（`workspace-screen.tsx`、`room-view.tsx`、`room-thread.tsx` など）は、使うルートの `_components/` に置く。
  `_` で始まるフォルダは Next.js のプライベートフォルダで、ルートにならない。
- 複数のルートで使うものは、それらに共通する最も近い親のルートの `_components/` に置く（例: `(chat)/_components/`）。
- `components/` は「props だけで描く」の境界を、ディレクトリの形で保つ。ストアに依存する部品を `components/` に入れない。

### 3. フックは `hooks/` にまとめる

- 共通のもの（`use-dismiss.ts`、`use-media-query.ts` など）は `hooks/` の直下、ドメインのものは `hooks/chat/`・`hooks/auth/` に置く。
- 1 つのルートでしか使わないフック（`useMessageActions`）も `hooks/chat/` に置く。探す場所を 1 つにするため。
- Context を読むフック（`useChatState`、`useSession`）も `hooks/` に置く。Provider のファイルは Context と Provider だけを持つ。
- localStorage の読み書きとフックが同じファイルにあるもの（`lib/composer-toolbar.ts`）は、読み書きを `lib/`、フックを `hooks/` に分ける。

### 4. `lib/` はドメインと役割でディレクトリに分ける

`lib/chat/` を次のように分ける（名前は実装の PR で最終的に決める）。

| ディレクトリ | 置くもの |
|---|---|
| `lib/chat/store/` | `createChatStore` と、それを分けたスライス、状態に当てる純粋関数（`messages` / `threads` / `pins` / `saved` / `reactions` / `activity-feed`） |
| `lib/chat/realtime/` | WebSocket の接続と購読（`connection` / `realtime` / `activity`） |
| `lib/chat/views/` | API の型から表示用の型への変換（`views` を画面ごとに分けたもの、`workspace-views`） |
| `lib/chat/format/` | 本文・時刻・リンク・メンションの解釈と整形（`body-format` / `format` / `links` / `link-cards` / `mentions`） |
| `lib/chat/notifications/` | ミュートとブラウザ通知（`notifications` / `desktop-notification` / `desktop-notifier` / `notification-prefs`） |
| `lib/chat/media/` | 画像の URL と添付のアップロード（`media` / `uploads` / `put-file`） |

`lib/` の直下には、ドメインを持たない小さな道具（`cx`、`ulid`、`anchored-position` など）だけを残す。

### 5. 大きなファイルは役割ごとに分ける

- 目安は 1 ファイル 300 行。超えたら、役割で分けられないかを見る（行数だけを理由に機械的に切らない）。
- **ストア**: `createChatStore` の外から見える形（`ChatStore` の型とメソッド）は変えない。中身を、共有する状態と `update` を持つ
  コンテキストを受け取るスライス（ワークスペース・ルーム・タイムライン・送信・スレッド・後で・アクティビティ・イベントなど）に分け、
  `createChatStore` はそれを組み立てるだけにする。テストもスライスに合わせてファイルを分ける。
- **表示用の変換**（`views.ts`）: 画面の単位（タイムライン・サイドバー・メンバー・スレッドなど）でファイルを分ける。
- **コンポーネント**: 1 ファイルに複数のダイアログやプラグインがあるもの（`room-dialogs.tsx`、`editor/plugins.tsx`）は 1 つずつに分ける。
  1 つのコンポーネントが大きいもの（`message-item.tsx`）は、同名のディレクトリを作り、部分の部品を並べる。
- **stories**: `screens.tsx` と `fixtures.ts` を、`stories/` の下のドメイン（`chat` / `workspace` / `settings` など）に合わせて分ける。
- テストは分けた実装のそばに置く（`foo.ts` と `foo.test.ts`）。

### 6. import のパス

- 親の階層へ上がる import（`../`）は ESLint（`no-restricted-imports`）で禁止し、`@/` から書く。
- 同じディレクトリの中（`./`）は相対パスのままでよい。一緒に動くファイル同士なので、ディレクトリごと動かしても直さずに済む。
- `index.ts` で束ね直す（barrel）ことはしない。import の先がそのまま実体のファイルになり、読むときに 1 段たどる手間と、
  束ねたファイルを経由した循環 import を避けるため。分けたディレクトリの入口は役割の名前にする（`lib/chat/store/chat-store.ts`）。
- ファイル名は今までどおり kebab-case（`use-media-query.ts`、`room-view.tsx`）。

### 7. 進め方

振る舞いを変えない PR に分ける。どの PR も今のテストが通る状態を保つ。

1. ディレクトリの移動（`hooks/`・`providers/`・`_components/`・`lib/` の分け直し）と ESLint のルール
2. `lib/chat/store.ts` の分割
3. `lib/chat/views.ts` の分割
4. コンポーネントの分割（`room-dialogs` / `message-item` / `editor/plugins` と、`app/` の大きな画面の部品）
5. `stories/` の分割

## 理由

- **`lib/` を React に依存しないものに絞る理由**: 置き場所を「`react` を import するか」という 1 つの問いで決められる。
  ストアや接続は React の外でテストしている（`store.test.ts` は描画しない）ので、その性質とディレクトリが一致する。
- **画面の部品を `app/…/_components/` に置く理由**: ADR 0018 は `components/` を「props だけで描く」と決めている。
  ストアにつないだ部品を `components/` に入れると、その境界が名前の約束でしか分からなくなる。`_components/` はルートのそばに置く
  Next.js の公式の方法で、どのルートの部品かがパスで分かる。
- **フックを 1 か所にまとめる理由**: 使う範囲でフックを `hooks/` と各ルートの `_hooks/` に分けると、範囲は明確になるが、探す場所が 2 つになる。
  範囲が変わる（別のルートでも使い始める）たびに移動も要る。
- **ストアの外から見える形を変えない理由**: 画面とテストがすべて `ChatStore` のメソッドを通して使っているので、
  形を保てば分割の PR は内部の移動だけになり、既存のテストがそのまま振る舞いの回帰の検査になる。
- **`../` だけを禁止する理由**: 移動で壊れるのは親をたどるパスで、同じディレクトリの中の `./` は一緒に動く。
  全部を `@/` にすると、同じディレクトリの中の import まで長くなる。

## 検討した代替案

- **画面の部品を `components/chat/containers/` に置く**: `app/` はルートだけになるが、`components/` にストアに依存する部品と
  props だけで描く部品が混ざる。上の理由で採らない。
- **機能ごとのディレクトリ（`features/chat/{components,hooks,lib}`）**: 機能の単位でまとまるが、React / Next.js の一般的な構成から離れる。
  このアプリの画面はほぼすべてが chat なので、分けても `features/chat/` に大半が入り、今の問題が 1 段下に移るだけになる。
- **ストアを外部のライブラリ（Zustand など）に置き換える**: スライスの仕組みは手に入るが、振る舞いを変えない分割という目的を越える。
  自作のストアは ADR 0024 / 0026 の決定で、置き換えるなら別の ADR で扱う。
- **ファイルの行数の上限を lint で強制する**: 分け方の判断を行数に任せることになる。目安にとどめ、PR で見る。

## 結果（トレードオフ）

- ファイルの移動が多く、移動した PR の前後で `git log` / `git blame` をたどるのに `--follow` が要る。移動と中身の変更は同じ PR に混ぜない。
- 過去の ADR に書いたファイルのパス（`lib/chat/store.ts` など）は、決めた時点の記録として書き換えない。今の場所はこの ADR の対応表から引く。
- `web/CLAUDE.md` に置き場所の判断の順序（決定 1）を書き、新しいファイルを足すときにそれに従う。
