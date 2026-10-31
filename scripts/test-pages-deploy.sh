#!/usr/bin/env bash
set -euo pipefail

test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
cat > "$test_dir/gh" <<'GH'
#!/usr/bin/env bash
[[ "$#" -eq 4 && "$1" == api && "$2" == "repos/$GITHUB_REPOSITORY" && "$3" == --jq && "$4" == .has_pages ]] || exit 90
case "$GH_TEST_RESULT" in
  true|false) printf '%s\n' "$GH_TEST_RESULT" ;;
  error) exit 42 ;;
  *) printf 'unexpected\n' ;;
esac
GH
chmod +x "$test_dir/gh"

check_case() {
  local repository="$1" response="$2" expected="$3"
  : > "$test_dir/output"
  GITHUB_REPOSITORY="$repository" GITHUB_OUTPUT="$test_dir/output" \
    GH_TEST_RESULT="$response" PATH="$test_dir:$PATH" \
    bash scripts/check-pages-deploy.sh > "$test_dir/stdout" 2> "$test_dir/stderr"
  [[ "$(cat "$test_dir/output")" == "deploy=$expected" ]]
}

check_case colbymchenry/codegraph error true
check_case partme-ai/codegraph true true
check_case partme-ai/codegraph false false
grep -q 'not configured' "$test_dir/stdout"

: > "$test_dir/output"
if GITHUB_REPOSITORY=partme-ai/codegraph GITHUB_OUTPUT="$test_dir/output" \
  GH_TEST_RESULT=error PATH="$test_dir:$PATH" \
  bash scripts/check-pages-deploy.sh > "$test_dir/stdout" 2> "$test_dir/stderr"; then
  echo 'Pages API failure must fail the workflow.' >&2
  exit 1
fi
[[ ! -s "$test_dir/output" ]]
grep -q 'Could not read Pages configuration' "$test_dir/stderr"
echo 'Pages deployment decision: official, enabled fork, unconfigured fork and API error passed.'
