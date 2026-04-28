#!/usr/bin/env bats
# tests/manifest.bats — REQ-MANIFEST-001..006, REQ-HOOKS-001..005

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

# ---------------------------------------------------------------------------
# Test 1: plugin.json is valid JSON
# ---------------------------------------------------------------------------
@test "manifest: plugin.json is valid JSON (jq -e exits 0)" {
  run jq -e . "$REPO_ROOT/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Test 2: plugin.json name field equals exact string
# ---------------------------------------------------------------------------
@test "manifest: plugin.json name equals 'claude-subagent-statusline'" {
  local name
  name="$(jq -r '.name' "$REPO_ROOT/.claude-plugin/plugin.json")"
  [ "$name" = "claude-subagent-statusline" ]
}

# ---------------------------------------------------------------------------
# Test 3: plugin.json version equals "0.2.1"  (REQ-MANIFEST-003)
# ---------------------------------------------------------------------------
@test "manifest: plugin.json version equals '0.3.1'" {
  local version
  version="$(jq -r '.version' "$REPO_ROOT/.claude-plugin/plugin.json")"
  [ "$version" = "0.3.1" ]
}

# ---------------------------------------------------------------------------
# Test 4: plugin.json repository URL exact match
# ---------------------------------------------------------------------------
@test "manifest: plugin.json repository equals expected URL" {
  local repo
  repo="$(jq -r '.repository' "$REPO_ROOT/.claude-plugin/plugin.json")"
  [ "$repo" = "https://github.com/GerardoFC8/claude-subagent-statusline" ]
}

# ---------------------------------------------------------------------------
# Test 5: hooks.json is valid JSON
# ---------------------------------------------------------------------------
@test "manifest: hooks.json is valid JSON (jq -e exits 0)" {
  run jq -e . "$REPO_ROOT/hooks/hooks.json"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Test 6: hooks.json declares PostToolUseFailure entry  (REQ-HOOKS-005)
# ---------------------------------------------------------------------------
@test "manifest: hooks.json declares PostToolUseFailure hook for Task matcher" {
  local has_failure
  has_failure="$(jq -r '
    .hooks.PostToolUseFailure // []
    | map(select(.matcher == "Task"))
    | length
  ' "$REPO_ROOT/hooks/hooks.json")"
  [ "$has_failure" -gt 0 ]
}

# ---------------------------------------------------------------------------
# Test 7: PostToolUseFailure hook has async:true  (REQ-HOOKS-003)
# ---------------------------------------------------------------------------
@test "manifest: hooks.json PostToolUseFailure entry has async:true" {
  local async_val
  async_val="$(jq -r '
    .hooks.PostToolUseFailure[0].hooks[0].async
  ' "$REPO_ROOT/hooks/hooks.json")"
  [ "$async_val" = "true" ]
}

# ---------------------------------------------------------------------------
# Test 8: PostToolUseFailure command references track-delegation-fail.sh
# ---------------------------------------------------------------------------
@test "manifest: hooks.json PostToolUseFailure command references track-delegation-fail.sh" {
  local cmd
  cmd="$(jq -r '
    .hooks.PostToolUseFailure[0].hooks[0].command
  ' "$REPO_ROOT/hooks/hooks.json")"
  [[ "$cmd" == *"track-delegation-fail.sh"* ]]
}

# ---------------------------------------------------------------------------
# Test 9: commands/subagents.md exists and is non-empty  (REQ-COMMAND-001, REQ-MANIFEST-006)
# ---------------------------------------------------------------------------
@test "manifest: commands/subagents.md exists and is non-empty" {
  [ -f "$REPO_ROOT/commands/subagents.md" ]
  [ -s "$REPO_ROOT/commands/subagents.md" ]
}
