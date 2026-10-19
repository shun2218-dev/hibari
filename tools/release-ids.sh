#!/usr/bin/env bash
# release の PR に並べる Linear の Issue の ID を集める（.claude/skills/linear）。
#
#   tools/release-ids.sh [<範囲>]
#       範囲（既定は origin/main..origin/develop）のコミットの本文から Issue の ID を集めて 1 行ずつ出力する。
#
# Linear の API は呼ばない。起票や状態の確認は Orca の CLI（`orca linear`）で行う。
# ここに残すのは git の履歴だけで決まる処理で、取りこぼすと Issue が Done にならないので、テストで固める。
set -euo pipefail

TEAM_KEY="${LINEAR_TEAM_KEY:-SHU}"
range="${1:-origin/main..origin/develop}"

# squash マージのコミットの本文は PR の本文なので、そこにある `Fixes <ID>` を拾う。
# Linear の識別子は大文字と小文字を区別しないが、出力は大文字にそろえる。
# 前を英数字・ハイフン・下線で区切らない（`X-SHU-1` のような別の識別子の一部を拾わない）。
git log --format=%B "$range" \
  | grep -oiE "(^|[^[:alnum:]_-])${TEAM_KEY}-[0-9]+\b" \
  | sed -E 's/^[^[:alnum:]]//' \
  | tr '[:lower:]' '[:upper:]' \
  | sort -t- -k2,2n -u \
  || true
