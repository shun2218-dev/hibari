---
extends: feature
when: hibari で機能を足すとき
---

# hibari: 機能を足す

- **Before** "`how` over the affected subsystem." `docs/roadmap.md` の現在のフェーズの範囲かを確かめる。範囲外ならオーナーに確認する。設計を変える（ADR が要る）なら、実装の前に ADR の PR を出して承認を待つ（CLAUDE.md「設計の正本」）。範囲内なら、linear のスキルで Issue を起票する（`tools/linear.sh create feature`）。
- **In** "Comments per **Comments**." hibari の Go と web のコードは「なぜ」のコメントが多い。周りの密度に合わせる。
- **In** "Verify on the matching surface." `make test` は同時に 1 本だけ実行する（CLAUDE.md「worktree」）。テストのない実装をコミットしない（CLAUDE.md「テスト」）。終わったと言う前に verifying-completion のスキルを使う。
