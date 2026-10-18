---
extends: bug-fix
when: hibari の不具合を直すとき
---

# hibari: 不具合を直す

- **After** "Binary-search the cause." hibari で原因を探すときの勘所（seq・配信の欠け・権限の反映・時刻）は `.claude/skills/debugging` の表を見る。
- **Replace** "Skip it when the test would be expensive, integration-heavy, or unclear." を「hibari では省かない」に置き換える。失敗するテストを先に書く。DB と Redis を使うものはモックにせず、実物で統合テストにする（CLAUDE.md「テスト」）。ブラウザの実物でしか起きないものだけ、再現の手順を PR に書く。
