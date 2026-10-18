---
name: linear
description: 機能追加（feat）やバグ修正（fix）に着手するとき、その PR を出すとき、release の PR を出すときに使う。Linear に Issue を起票し、PR の本文に `Fixes <ID>` を書いて、Linear の GitHub 連携に状態を進めさせる。
---

# Linear で作業を追う

Issue を起票し、PR と結び付けるのはこのスキルの仕事。状態を進め、閉じるのは Linear の GitHub 連携の仕事。
マージは GitHub の画面でも起きるので、Claude が API で閉じる形にすると取りこぼす。だから閉じる処理は持たない。

## Linear の側の設定（2026-10-19 に作成済み）

| 項目 | 値 |
|---|---|
| チーム | `SHU`（Portfolio Site と共有。`LINEAR_TEAM_KEY` で変えられる） |
| プロジェクト | `hibari`（起票はすべてここに入れる） |
| ラベル | feat → `Feature`、fix → `Bug` |
| 既定の規則 | ブランチを作る → In Progress、PR を出す → In Review、マージ → Done |
| develop 向けの規則 | develop へのマージ → **リリース待ち** |

つまり、feature / bugfix の PR が develop に入ると「リリース待ち」になり、release の PR が main に入ると Done になる。

API キーは `.env` の `LINEAR_API_KEY`。`tools/linear.sh` がメインのチェックアウトの `.env` から読むので、worktree からも使える。キーを出力・ログ・PR に書かない。

## 起票する（feat と fix だけ）

docs / chore / ci / refactor / test / build / perf は起票しない。

1. 着手するとき、ブランチを切る前に起票する。

   ```sh
   tools/linear.sh create feature "<タイトル>" [<説明の Markdown ファイル>]
   tools/linear.sh create bug "<タイトル>" [<説明の Markdown ファイル>]
   ```

   出力は `<ID>\t<URL>`（例: `SHU-30	https://linear.app/...`）。状態は最初から In Progress。
2. タイトルは日本語で、何ができるようになるか（feat）、何が壊れているか（fix）を書く。Conventional Commits の type は付けない。
3. 説明には、ロードマップのフェーズ・関連する ADR・完了の条件を書く。バグなら再現の手順も書く。説明のファイルは scratchpad に置き、コミットしない。
4. ブランチ名は CLAUDE.md の決まり（`feature/<内容>`）のまま。ID は入れなくてよい（PR の本文で結び付く）。

## PR を出す

- feature / bugfix の PR の本文の `## 関連` に `Fixes <ID>` を書く。1 つの PR で複数の Issue を片付けるなら `Fixes SHU-30, SHU-31`。
- squash マージで PR の本文がコミットの本文になる。release のときにそこから ID を集めるので、`Fixes` の行を消さない。
- 起票しない種類の PR（docs など）には書かない。

## release の PR を出す

1. CLAUDE.md「リリース手順」で `release/vX.Y.Z` の PR を出すときに、含まれる Issue を集める。

   ```sh
   git fetch origin
   tools/linear.sh release-ids origin/main..origin/develop
   ```

2. 出てきた ID を、main 向けの PR の本文に `Fixes SHU-30, SHU-31, …` と並べる。main へのマージで、Linear の既定の規則が Done にする。
3. develop へ戻す PR には書かない（develop 向けの規則で「リリース待ち」に戻ってしまうため）。
4. マージの後、いくつかの ID について `tools/linear.sh state <ID>` を実行し、Done になったことを確かめる。なっていなければ、オーナーに報告する。API で閉じて取り繕わない。

hotfix も同じ。`hotfix/vX.Y.Z` → main の PR に `Fixes` を書き、develop に戻す PR には書かない。

## 確かめていないこと

1 つの Issue に、develop 向けと main 向けの 2 本の PR が結び付いたときに、main へのマージで Done になること。
Linear の資料には「結び付いた最後の PR が条件を満たしたときに状態が変わる」とある。最初のリリースで実物を確かめ、結果をこの節に書く。
