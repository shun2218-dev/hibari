@AGENTS.md

# ファイルの置き場所（ADR 0060）

新しいファイルは、上から順に当てはまったところに置く。

1. `react` を import しない → `lib/`（ドメインごとに `lib/chat/store/` などのディレクトリへ）
2. フック（`use` で始まる関数）→ `hooks/`（共通は直下、ドメインのものは `hooks/chat/`・`hooks/auth/`）
3. Context を作って Provider で配る → `providers/`（Context を読むフックは `hooks/` に置く）
4. props だけで描ける → `components/`
5. ストアやルーターにつないで描く → 使うルートの `app/…/_components/`（複数のルートで使うなら、共通の最も近い親のルート）

- 親の階層へ上がる import（`../`）は書かない。`@/` から書く（ESLint が止める）。同じディレクトリの中は `./` でよい。
- `index.ts` で束ね直さない。分けたディレクトリの入口は役割の名前にする（`lib/chat/store/chat-store.ts`）。
- 1 ファイル 300 行を目安に、超えたら役割で分けられないかを見る。テストは実装の隣に置く。
- リポジトリの `testdata/` は `@testdata/` で import する。

