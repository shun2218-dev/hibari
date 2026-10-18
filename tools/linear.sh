#!/usr/bin/env bash
# Linear の Issue を起票し、リリースに含まれる Issue の ID を集める（.claude/skills/linear）。
#
#   tools/linear.sh create feature|bug <タイトル> [<説明の Markdown ファイル>]
#       チーム（LINEAR_TEAM_KEY）の hibari プロジェクトに起票し、「<ID>\t<URL>」を出力する。
#   tools/linear.sh release-ids [<範囲>]
#       範囲（既定は origin/main..origin/develop）のコミットの本文から Issue の ID を集めて 1 行ずつ出力する。
#   tools/linear.sh state <ID>
#       Issue の状態の名前を出力する。
#
# Issue を閉じる処理はここに持たない。PR の本文の `Fixes <ID>` を見て、Linear の GitHub 連携が状態を進める
# （develop へのマージで「リリース待ち」、main へのマージで Done）。マージは GitHub の画面でも起きるので、
# Claude が API を呼ぶことに頼ると取りこぼすため。
#
# API キーは LINEAR_API_KEY。環境変数になければ、メインのチェックアウトの .env から読む
# （worktree には .env がないため）。キーは出力しない。
set -euo pipefail

TEAM_KEY="${LINEAR_TEAM_KEY:-SHU}"
PROJECT_NAME="${LINEAR_PROJECT:-hibari}"
API="https://api.linear.app/graphql"

die() { echo "linear.sh: $*" >&2; exit 1; }

# release-ids は API を使わないので、キーがなくても動くようにする（テストもキーなしで回す）。
api_key() {
  if [[ -n "${LINEAR_API_KEY:-}" ]]; then
    printf '%s' "$LINEAR_API_KEY"
    return
  fi
  local root env
  root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
  env="$root/.env"
  [[ -f "$env" ]] || die "LINEAR_API_KEY がない（環境変数にも $env にもない）"
  sed -n 's/^LINEAR_API_KEY=//p' "$env" | tr -d "\"'" | head -n 1
}

# GraphQL を呼び、errors があれば止める。変数は jq で組み立てて、タイトルなどの引用符で壊れないようにする。
gql() {
  local query="$1" vars='{}' key body
  # 変数を渡したのに空なら、呼び出し側の jq が失敗している（$(...) の失敗は set -e で止まらない）。
  if (( $# >= 2 )); then
    vars="$2"
    [[ -n "$vars" ]] || die "GraphQL の変数の組み立てに失敗した"
  fi
  key="$(api_key)"
  [[ -n "$key" ]] || die "LINEAR_API_KEY が空"
  body="$(jq -n --arg q "$query" --argjson v "$vars" '{query: $q, variables: $v}')"
  local res
  res="$(curl -sS --fail-with-body "$API" -H "Authorization: $key" -H 'Content-Type: application/json' -d "$body")" \
    || die "API の呼び出しに失敗した: $res"
  if jq -e '.errors' >/dev/null <<<"$res"; then
    die "API がエラーを返した: $(jq -c '.errors' <<<"$res")"
  fi
  printf '%s' "$res"
}

cmd_create() {
  local kind="${1:-}" title="${2:-}" desc_file="${3:-}"
  local label
  case "$kind" in
    feature) label="Feature" ;;
    bug) label="Bug" ;;
    *) die "種類は feature か bug（$kind）" ;;
  esac
  [[ -n "$title" ]] || die "タイトルがない"
  local desc=""
  if [[ -n "$desc_file" ]]; then
    [[ -f "$desc_file" ]] || die "説明のファイルがない: $desc_file"
    desc="$(cat "$desc_file")"
  fi

  # チーム・プロジェクト・ラベル・状態は名前で引く。ID を書き込むと、Linear 側で作り直したときに壊れるため。
  local meta
  meta="$(gql 'query($key: String!, $project: String!) {
      teams(filter: {key: {eq: $key}}) { nodes { id
        labels { nodes { id name } }
        states { nodes { id name } } } }
      projects(filter: {name: {eq: $project}}) { nodes { id } }
    }' "$(jq -n --arg key "$TEAM_KEY" --arg project "$PROJECT_NAME" '{key: $key, project: $project}')")"

  local team_id project_id label_id state_id
  team_id="$(jq -r '.data.teams.nodes[0].id // empty' <<<"$meta")"
  project_id="$(jq -r '.data.projects.nodes[0].id // empty' <<<"$meta")"
  label_id="$(jq -r --arg n "$label" '.data.teams.nodes[0].labels.nodes[] | select(.name == $n) | .id' <<<"$meta")"
  # 起票するのは着手するときなので、最初から In Progress にする。
  state_id="$(jq -r '.data.teams.nodes[0].states.nodes[] | select(.name == "In Progress") | .id' <<<"$meta")"
  [[ -n "$team_id" ]] || die "チーム $TEAM_KEY が見つからない"
  [[ -n "$project_id" ]] || die "プロジェクト $PROJECT_NAME が見つからない"
  [[ -n "$label_id" ]] || die "ラベル $label が見つからない"
  [[ -n "$state_id" ]] || die "状態 In Progress が見つからない"

  local res
  res="$(gql 'mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { identifier url } }
    }' "$(jq -n --arg team "$team_id" --arg project "$project_id" --arg label "$label_id" \
      --arg state "$state_id" --arg title "$title" --arg desc "$desc" \
      '{input: ({teamId: $team, projectId: $project, labelIds: [$label], stateId: $state, title: $title}
        + (if $desc == "" then {} else {description: $desc} end))}')")"
  jq -r '.data.issueCreate.issue | "\(.identifier)\t\(.url)"' <<<"$res"
}

cmd_release_ids() {
  local range="${1:-origin/main..origin/develop}"
  # squash マージのコミットの本文は PR の本文なので、そこにある `Fixes <ID>` を拾う。
  # Linear の識別子は大文字と小文字を区別しないが、出力は大文字にそろえる。
  # 前を英数字・ハイフン・下線で区切らない（`X-SHU-1` のような別の識別子の一部を拾わない）。
  git log --format=%B "$range" \
    | grep -oiE "(^|[^[:alnum:]_-])${TEAM_KEY}-[0-9]+\b" \
    | sed -E 's/^[^[:alnum:]]//' \
    | tr '[:lower:]' '[:upper:]' \
    | sort -t- -k2,2n -u \
    || true
}

cmd_state() {
  local id="${1:-}"
  [[ -n "$id" ]] || die "ID がない"
  gql 'query($id: String!) { issue(id: $id) { state { name } } }' \
    "$(jq -n --arg id "$id" '{id: $id}')" | jq -r '.data.issue.state.name'
}

main() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    create) cmd_create "$@" ;;
    release-ids) cmd_release_ids "$@" ;;
    state) cmd_state "$@" ;;
    *) die "使い方: tools/linear.sh create feature|bug <タイトル> [<説明のファイル>] | release-ids [<範囲>] | state <ID>" ;;
  esac
}

main "$@"
