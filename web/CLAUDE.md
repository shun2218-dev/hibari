@AGENTS.md

# ファイルの置き場所（ADR 0060）

新しいファイルは、上から順に当てはまったところに置く。

1. `react` を import しない → `lib/`（ドメインごとに `lib/chat/store/` などのディレクトリへ）
2. フック（`use` で始まる関数）→ `hooks/`（共通は直下、ドメインのものは `hooks/chat/`・`hooks/auth/`）
3. Context を作って Provider で配る → `providers/`（Context を読むフックは `hooks/` に置く）
4. props だけで描ける → `components/`
5. ストアやルーターにつないで描く → 使うルートの `app/…/_components/`（複数のルートで使うなら、共通の最も近い親のルート）

- 親の階層へ上がる import（`../`）は書かない。`@/` から書く（ESLint が止める）。同じディレクトリの中は `./` でよい。
- `index.ts` で束ね直さない。分けたディレクトリの入口の名前は次のとおり。
  - `lib/` は「ドメイン + 役割」にする（`lib/chat/store/chat-store.ts`、`lib/chat/api/chat-api.ts`、`lib/auth/session/auth-session.ts`）。
  - 入口でないファイルは役割の名前にする（`lib/chat/realtime/subscriptions.ts`、`lib/chat/notifications/mute.ts`）。
  - どちらも**ディレクトリ名をそのまま繰り返さない**。繰り返したくなるのは、名前が役割を表していない合図。
  - `components/` はディレクトリと同じ名前にする（`components/chat/message-item/message-item.tsx`）。React の慣習に合わせる。
- **行数だけを理由にファイルを分けない。** 役割が混ざっているときに分ける（複数のダイアログ・プラグインが 1 ファイルにある、など）。
  300 行はその見直しのきっかけにするだけで、1 つの部品やコンテナが大きいのはそのままでよい。テストは実装の隣に置く。
- リポジトリの `testdata/` は `@testdata/` で import する。

# Storybook の story を作る条件（ADR 0047 決定 12 の追記）

- `components/ui/` の部品には story を作る。作らないものは `stories/stories.test.tsx` の `uiWithoutStory` に理由を書く
  （入れてよいのは、単体では見た目を持たない土台だけ）。忘れると `stories.test.tsx` が落ちる。
- `components/` のそれ以外は、その部品だけが持つ状態の軸があるものに作る。画面の story とほぼ同じになる大きい部品には作らない。
- 画面の story（`stories/`）は `docs/ui/screenshots/` の PNG と 1 対 1。

