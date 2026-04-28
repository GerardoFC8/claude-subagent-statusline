#!/usr/bin/env bats
# tests/manifest.bats — REQ-MANIFEST-001..004, REQ-HOOKS-001

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
# Test 3: plugin.json version equals "0.1.0"
# ---------------------------------------------------------------------------
@test "manifest: plugin.json version equals '0.1.0'" {
  local version
  version="$(jq -r '.version' "$REPO_ROOT/.claude-plugin/plugin.json")"
  [ "$version" = "0.1.0" ]
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
