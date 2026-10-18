#!/usr/bin/env bash
# docs/*.mermaid から docs/*.svg を生成する（ADR 0009）。
# ホストに Node / Chromium を要求しないよう、mermaid-cli の Docker イメージを使う。
set -euo pipefail

cd "$(dirname "$0")/.."

MERMAID_CLI_IMAGE="${MERMAID_CLI_IMAGE:-minlag/mermaid-cli:11.17.1}"

for src in docs/*.mermaid; do
  name="$(basename "$src" .mermaid)"
  echo "render: $src -> docs/$name.svg"
  docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "$PWD/docs:/data" \
    "$MERMAID_CLI_IMAGE" \
    -i "/data/$name.mermaid" -o "/data/$name.svg" -b white
  chmod 644 "docs/$name.svg"
done
