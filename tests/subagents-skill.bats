#!/usr/bin/env bats
# tests/subagents-skill.bats — REQ-COMMAND-001..006
# Markdown lint tests for commands/subagents.md (v0.3.0: thin passthrough to render-subagents.sh).

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SKILL_FILE="$REPO_ROOT/commands/subagents.md"

# ---------------------------------------------------------------------------
# Test 1: skill file exists  (REQ-COMMAND-001)
# ---------------------------------------------------------------------------
@test "skill: commands/subagents.md exists" {
  [ -f "$SKILL_FILE" ]
}

# ---------------------------------------------------------------------------
# Test 2: frontmatter has description field
# ---------------------------------------------------------------------------
@test "skill: has frontmatter with 'description:' key" {
  grep -qF 'description:' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 3: declares allowed-tools Bash
# ---------------------------------------------------------------------------
@test "skill: declares allowed-tools: Bash" {
  grep -qF 'allowed-tools: Bash' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 4: has argument-hint in frontmatter
# ---------------------------------------------------------------------------
@test "skill: has argument-hint in frontmatter" {
  grep -qF 'argument-hint:' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 5: invokes render-subagents.sh  (REQ-COMMAND-002)
# ---------------------------------------------------------------------------
@test "skill: invokes render-subagents.sh" {
  grep -qF 'render-subagents.sh' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 6: passes \$ARGUMENTS to the script  (REQ-COMMAND-003)
# ---------------------------------------------------------------------------
@test "skill: passes \$ARGUMENTS to render-subagents.sh" {
  grep -qF '"$ARGUMENTS"' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 7: uses CLAUDE_PLUGIN_ROOT for script path  (REQ-COMMAND-004)
# ---------------------------------------------------------------------------
@test "skill: uses CLAUDE_PLUGIN_ROOT to reference script" {
  grep -qF 'CLAUDE_PLUGIN_ROOT' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 8: instructs verbatim output (no commentary)  (REQ-COMMAND-005)
# ---------------------------------------------------------------------------
@test "skill: instructs verbatim stdout output with no commentary" {
  grep -qF 'verbatim' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 9: manifest test — commands/subagents.md is non-empty  (REQ-MANIFEST-006)
# ---------------------------------------------------------------------------
@test "skill: commands/subagents.md is non-empty" {
  [ -s "$SKILL_FILE" ]
}

# ---------------------------------------------------------------------------
# Test 10: does NOT contain the old heavy jq fold pipeline (v0.3.0 cleanup)
# ---------------------------------------------------------------------------
@test "skill: does NOT contain old group_by(.tool_use_id) jq pipeline" {
  ! grep -qF 'group_by(.tool_use_id)' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 11: does NOT contain Cost column (removed in v0.2.0, kept absent)
# ---------------------------------------------------------------------------
@test "skill: does NOT contain Cost column reference" {
  ! grep -qF '| Cost' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 12: script render-subagents.sh exists and is executable
# ---------------------------------------------------------------------------
@test "skill: render-subagents.sh exists and is executable" {
  local script="$REPO_ROOT/scripts/render-subagents.sh"
  [ -f "$script" ]
  [ -x "$script" ]
}
