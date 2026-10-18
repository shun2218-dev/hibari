---
extends: shipping
when: hibari の PR をマージするとき
---

# hibari: マージする

pstack の Shipping を、hibari のマージの決まり（CLAUDE.md「PR とマージ」）に合わせる。

- **Before** "Resolve the forge, then verify each PR independently before it lands." ADR・デザイン（`docs/ui/`）・`docs/` の設計の正本を変える PR は、オーナーの承認があるまでマージしない。CI が通った実装の PR は、承認を待たずにマージしてよい。
- **In** "Land bottom-up, one PR at a time." feature / bugfix → `develop` は `--squash`。release / hotfix → `main` と `develop` は `--merge`（squash しない。`main` と `develop` の履歴を分けないため）。タグとリリースノートは CLAUDE.md「リリース手順」に従う。
