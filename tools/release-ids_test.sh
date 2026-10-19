#!/usr/bin/env bash
# tools/release-ids.sh を、使い捨ての git リポジトリで確かめる。
# release の PR に並べる ID を取りこぼす・余計に拾うと、Issue が Done にならない・別の Issue を閉じるため。
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/release-ids.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cd "$work"
git init -q -b main
git config user.email test@example.com
git config user.name test
commit() { git commit -q --allow-empty -m "$1"; }

commit "chore: 最初"
git checkout -q -b develop
commit "$(printf 'feat(chat): 検索 (#10)\n\n## 関連\n\nFixes SHU-12')"
commit "$(printf 'fix(web): 表示 (#11)\n\nFixes shu-3, SHU-12')"
commit "$(printf 'docs: ADR (#12)\n\nSHU-7 を参照。PORTFOLIO-SHU-99 や XSHU-5 は拾わない')"
commit "docs: Issue のないもの (#13)"

fail=0
check() {
  local name="$1" want="$2" got="$3"
  if [[ "$got" != "$want" ]]; then
    printf 'FAIL %s\n  want: %q\n  got:  %q\n' "$name" "$want" "$got"
    fail=1
  else
    printf 'ok   %s\n' "$name"
  fi
}

check "重複を除き、大文字にそろえ、番号順に並べる" \
  "$(printf 'SHU-3\nSHU-7\nSHU-12')" \
  "$("$script" main..develop)"

check "範囲に Issue がなければ何も出さない" \
  "" \
  "$("$script" develop~1..develop)"

check "チームのキーを変えられる" \
  "" \
  "$(env LINEAR_TEAM_KEY=HIB "$script" main..develop)"

exit "$fail"
