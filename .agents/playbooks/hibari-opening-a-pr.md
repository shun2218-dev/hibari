---
extends: opening-a-pr
when: hibari で PR を作るとき（feature / bugfix は develop へ、release / hotfix は main と develop へ）
---

# hibari: PR を作る

pstack の Opening a PR を、hibari の Git Flow（CLAUDE.md「Git 運用」）に合わせる。

- **Replace** "Work from a git worktree off main." を「`develop` から切った worktree（`.claude/worktrees/<名前>`）で作業する。release は `develop` から、hotfix は `main` から切る」に置き換える。trunk は `main` ではなく `develop`。
- **Replace** "Run `/deslop` over the diff before commit and `/no-comments` before review." を「コミットの前に `/deslop` を通す。`/no-comments` は使わない」に置き換える。hibari はコメントに「なぜ」を書く（CLAUDE.md「目的」）。
- **In** "Conventional Commits `type(scope): subject`, no trailing period." 要約は日本語で書く。type と scope は CLAUDE.md「コミットメッセージ」の表から選ぶ。
- **In** "Use `##` headings, not bold lead-ins, in this order" 本文は日本語で、見出しを `## なぜ` / `## 何を変えたか` / `## 範囲` / `## 代替案`（あれば）/ `## 影響` / `## テスト内容` / `## 関連` にする。`## 関連` には ADR とロードマップのフェーズを書く（CLAUDE.md「PR とマージ」）。feat / fix の PR と、release / hotfix → `main` の PR には `Fixes <ID>` も書く（linear のスキル）。`## テスト内容` には実際に実行したものだけを書く（verifying-completion のスキル）。
- **In** "The root PR targets trunk." hibari の trunk は `develop`（hotfix だけは `main`）。feature / bugfix は squash マージなので、親の PR がマージされたら、子の PR を `develop` に付け替え、子だけのコミットを載せ直す。
