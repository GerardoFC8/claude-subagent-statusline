#!/usr/bin/env bash
# tests/helpers.bash — shared bats helpers
# Sourced by all .bats files. Provides clean HOME isolation and convenience runners.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

setup() {
  # Each test gets its own temporary HOME so real ~/.claude/state is never touched.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude/state"
  # Ensure CLAUDE_PLUGIN_DATA is unset so each test starts with fallback path.
  unset CLAUDE_PLUGIN_DATA
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

# run_fail <json>  — pipe <json> to track-delegation-fail.sh
run_fail() {
  printf '%s' "$1" | "$REPO_ROOT/scripts/track-delegation-fail.sh"
}

# history_file_for — echo the resolved history path under the test HOME,
# respecting CLAUDE_PLUGIN_DATA precedence (mirrors history-lib.sh logic).
history_file_for() {
  if [[ -n "${CLAUDE_PLUGIN_DATA:-}" ]]; then
    printf '%s/history.jsonl\n' "$CLAUDE_PLUGIN_DATA"
  else
    printf '%s/.claude/state/delegation-history.jsonl\n' "$HOME"
  fi
}

# with_small_ring — export a tiny ring buffer for ring-buffer tests.
with_small_ring() {
  export HISTORY_TRIM_THRESHOLD=6
  export HISTORY_KEEP=5
}
