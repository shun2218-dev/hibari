# 0009. 図は mermaid を正本とし、SVG は mermaid-cli で生成する

- 状態: 採用
- 日付: 2026-09-13

## 背景

`docs/*.mermaid` を正本、`docs/*.svg` を人間用のレンダリング結果とする運用だった。
しかし `tools/gen_arch.py` / `tools/gen_erd.py` は mermaid を読んでおらず、図の内容を Python に直書きしていた。そのため mermaid を更新しても SVG は変わらない。出力先も `/home/claude/hibari/docs/` に固定されていて、ローカルでは動かなかった。

## 決定

- SVG は `tools/render-diagrams.sh` で mermaid から直接生成する。
- レンダラは mermaid-cli の Docker イメージ（`minlag/mermaid-cli`）を使い、ホストに Node や Chromium を要求しない。
- `tools/gen_arch.py` / `tools/gen_erd.py` は廃止する。
- Phase 1 で `make diagrams` から呼べるようにする。

## 理由

- 正本が 1 つになり、「どちらが正しいか分からない」状態がなくなる。
- ホストの依存を増やさない方針（Phase 1 の DoD）に合う。

## 結果（トレードオフ）

- Python 版が持っていた AWS 風の独自の見た目は失われ、mermaid の標準の見た目になる。
- 初回はイメージの取得に時間がかかる。
