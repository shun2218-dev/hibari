---
name: performance-tuning
description: hibari の遅い・重い・クエリが多い・メモリやコネクションが足りない、といった性能の問題を調べるときに使う。hibari での測り方と、速くするときに崩してはいけない決まり。手順そのものは pstack の Perf issue に従う。
---

# 性能の問題を直すときの hibari の勘所

手順は pstack の Perf issue の playbook に従う（測ってから直す・軽い直し方から順に試す・1 つずつ確かめる）。
測った数字を報告する前に `pstack:benchmark-checklist` を通す。
ここには hibari 固有のことだけを書く。
もとは addyosmani/agent-skills の performance-optimization（MIT）の考え方を参考に書いた。

## 測り方

- SQL: `EXPLAIN (ANALYZE, BUFFERS)` で計画と実際の時間を見る。実行回数は、テストやログでクエリの数を数える（N+1 を探す）。
- Go: `go test -bench` と `-benchmem`、`pprof`（CPU・メモリ・goroutine）。
- Redis: 1 回の操作で何往復しているか（パイプラインや Lua にまとめられるか）。
- web: ブラウザの Performance、React の再描画の回数、送っている要求の数と大きさ。
- 手元の compose はほかの worktree と共有している（CLAUDE.md「worktree」）。ほかの `make test` が走っている間に測った数字は使わない。

## 崩してはいけない決まり

速さのために CLAUDE.md の決まり（順序は `seq`、OFFSET を使わない、N+1 にしない、presence は Redis など）を崩さない。
崩したくなったら、それは設計の変更なので ADR からオーナーに相談する。

- **索引**は、クエリの形（`WHERE` と `ORDER BY`）に合わせる。`EXPLAIN ANALYZE` で使われることを確かめてから足す。足すとマイグレーションが増え、書き込みが少し遅くなる。`CONCURRENTLY` が要るかも考える。
- **キャッシュ**は、何をキーにして、いつ古くなり、誰がどう消すかを決めてから足す。権限の変更（ルール 8）や編集・削除（`change_seq`）を取りこぼさないこと。キャッシュを足すのは設計の変更なので ADR から。
- **コネクションの枯渇**（pgx のプールが空く・待つ）は、トランザクションの中でネットワークを待っていないか（ADR 0065 決定 10）、閉じ忘れがないかを先に疑う。プールを大きくするのは最後。
- **並行に増やす**（goroutine を増やす）なら、終わる条件とリークしないテストも書く（CLAUDE.md「Go 全般」）。
- 測るためのコードやログ（時間の計測・一時的な出力）は、PR に残さない。

## 残すもの

PR の説明に、直す前と後の数字・測り方・試して戻したものを書く。索引やキャッシュを足したなら、なぜ要るかをコメントか ADR に書く。
