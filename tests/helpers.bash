#!/usr/bin/env bash
# tests/helpers.bash — shared bats helpers
# Sourced by all .bats files. Provides clean HOME isolation and convenience runners.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

setup() {
  # Each test gets its own temporary HOME so real ~/.claude/state is never touched.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude/state"
}

teardown() {
  # bats handles BATS_TEST_TMPDIR cleanup; nothing to do here.
  :
}

# run_pre <json>  — pipe <json> to track-delegation-pre.sh; exits with script exit code
run_pre() {
  printf '%s' "$1" | "$REPO_ROOT/scripts/track-delegation-pre.sh"
}

# run_post <json>  — pipe <json> to track-delegation-post.sh
run_post() {
  printf '%s' "$1" | "$REPO_ROOT/scripts/track-delegation-post.sh"
}

# run_statusline <json>  — pipe <json> to statusline.sh; stdout captured in $output by bats
run_statusline() {
  printf '%s' "$1" | "$REPO_ROOT/scripts/statusline.sh"
}

# state_file_for <session_id>  — echo expected JSONL path under the test HOME
state_file_for() {
  printf '%s/.claude/state/delegations-%s.jsonl\n' "$HOME" "$1"
}
