#!/usr/bin/env bats
# tests/subagents-skill.bats — REQ-COMMAND-001..006
# Markdown lint tests: assert required sections and prescriptive content
# are present in commands/subagents.md. No markdown parser needed — grep -F.

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
# Test 3: declares allowed-tools Bash and Read
# ---------------------------------------------------------------------------
@test "skill: declares allowed-tools: Bash, Read" {
  grep -qF 'allowed-tools: Bash, Read' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 4: has argument-hint in frontmatter
# ---------------------------------------------------------------------------
@test "skill: has argument-hint in frontmatter" {
  grep -qF 'argument-hint:' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 5: contains path-resolution env var and fallback  (REQ-COMMAND-002)
# ---------------------------------------------------------------------------
@test "skill: contains CLAUDE_PLUGIN_DATA env var reference" {
  grep -qF 'CLAUDE_PLUGIN_DATA' "$SKILL_FILE"
}

@test "skill: contains delegation-history.jsonl fallback path" {
  grep -qF 'delegation-history.jsonl' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 6: contains the empty-state literal  (REQ-COMMAND-003)
# ---------------------------------------------------------------------------
@test "skill: contains empty-state message 'No delegations recorded yet.'" {
  grep -qF 'No delegations recorded yet.' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 7: contains the fold jq pipeline anchor  (REQ-COMMAND-004)
# ---------------------------------------------------------------------------
@test "skill: contains fold jq pipeline using group_by(.tool_use_id)" {
  grep -qF 'group_by(.tool_use_id)' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 8: contains the table header markers  (REQ-COMMAND-004)
# ---------------------------------------------------------------------------
@test "skill: contains table header with # column" {
  grep -qF '| #' "$SKILL_FILE"
}

@test "skill: contains table header with Description column hint" {
  grep -qF 'Description' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 9: contains the stats jq fragment  (REQ-COMMAND-005)
# ---------------------------------------------------------------------------
@test "skill: contains stats jq fragment group_by(.subagent_type" {
  grep -qF 'group_by(.subagent_type' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 10: hard cap at 100 is documented  (REQ-COMMAND-004)
# ---------------------------------------------------------------------------
@test "skill: documents hard cap at 100 entries" {
  grep -qF '100' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Test 11: detail mode header is present  (REQ-COMMAND-006)
# ---------------------------------------------------------------------------
@test "skill: contains detail mode header 'Delegation #'" {
  grep -qF 'Delegation #' "$SKILL_FILE"
}

# ---------------------------------------------------------------------------
# Post-gate delta tests (Change B + E)
# ---------------------------------------------------------------------------

# Test 12: Tokens column present (Change B — replaces Cost)
@test "skill: table header contains Tokens column" {
  grep -qF 'Tokens' "$SKILL_FILE"
}

# Test 13: usage.input_tokens jq usage present (Change B)
@test "skill: contains usage.input_tokens jq reference" {
  grep -qF 'usage.input_tokens' "$SKILL_FILE"
}

# Test 14: Cost column NOT present in table header example (Change B)
@test "skill: table header example does not contain Cost column" {
  # The table header line must not have '| Cost' (removed column)
  # We use grep -v to confirm the table example no longer has a Cost header cell
  ! grep -qF '| Cost' "$SKILL_FILE"
}

# Test 15: detail mode includes Response section (Change E)
@test "skill: detail mode includes Response section heading" {
  grep -qF '## Response' "$SKILL_FILE"
}

# Test 16: detail mode response null case documented (Change E)
@test "skill: detail mode documents null response fallback" {
  grep -qF 'no response captured' "$SKILL_FILE"
}
