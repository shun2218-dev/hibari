---
name: verifying-completion
description: 「終わった」「テストが通った」「直った」「CI が通る」と報告する前、コミット・PR を作る前、マージの前に使う。hibari で何を言うには何を実行するか。その場で実行した結果を示してから言う。
---

# 終わったと言う前に確かめる

原則は `pstack:principle-prove-it-works`（実物を直接確かめる・出力を切った結果や自分の echo は証拠にならない・失敗するテストは失敗の中身が予想どおりかを確かめる）。
テストが振る舞いを確かめているかは `pstack:principle-test-behavior-not-implementation`。
ここには hibari で何を実行すればよいかを書く。
もとは obra/superpowers の verification-before-completion（MIT）の考え方を参考に書いた。

## 何を言うには何が要るか

| 言いたいこと | 要るもの |
|---|---|
| Go のテストが通る | `make test`（`go test -race -count=1 ./...`）の結果。DB と Redis は実物。ほかの worktree の `make test` と同時に走らせない |
| Go の lint が通る | `make lint`（`go vet` と golangci-lint）の結果 |
| web のテストが通る | `make web-test` か、`web/` で `npm run lint`・`npm run typecheck`・`npm test` の結果 |
| tools/ のスクリプトが動く | `make tools-test` の結果 |
| 生成物が最新 | `make ts-types`・`make openapi`・`make sqlc` の後に `git status` で差分がない、または差分をコミットした |
| 画面が直った | ブラウザ（プレビュー）か Storybook で見た結果。見た目を変えたなら `docs/ui/` のスクリーンショットを撮り直した |
| 不具合が直った | 直す前に、予想どおりの中身で失敗したテストが、直した後に通る |
| CI が通った | PR のチェックがすべて成功していること（`gh pr checks`）。手元で通っただけでは CI が通ったとは言わない |
| 実物で動く（音声・映像・通知など） | オーナーが実物で確かめた。自分で確かめられないものは「実物の確認はオーナーに頼む」と書く |

## コミット・PR・マージの前

- 1 コミット 1 論理変更で、各コミットの時点でテストが通る（CLAUDE.md「コミットメッセージ」）。
- PR の説明の「テスト内容」には、実際に実行したものだけを書く。一部だけ実行したなら、どこまで実行したかを書く。
- マージしてよいのは CI が通った実装の PR だけ。ADR・デザイン・設計の正本を変える PR は、オーナーの承認を待つ（CLAUDE.md「AI での開発の進め方」）。

## 報告の書き方

- 結果を先に書く（通った / 落ちた / 確かめられなかった）。
- 落ちたものは、テスト名と理由を 1 行ずつ。自分の変更のせいか、前から落ちていたかを分けて書く。
- 確かめていないことは、確かめていないと書く。
