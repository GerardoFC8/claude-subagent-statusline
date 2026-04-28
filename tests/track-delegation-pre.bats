#!/usr/bin/env bats
# tests/track-delegation-pre.bats — REQ-TRACK-PRE-001..007

load helpers

# ---------------------------------------------------------------------------
# Test 1: happy path — creates state file with running entry
# ---------------------------------------------------------------------------
@test "pre: happy path — appends running entry to state file" {
  local payload='{"tool_use_id":"toolu_ABC","session_id":"S1","tool_input":{"subagent_type":"sdd-spec","description":"Write spec"}}'
  run run_pre "$payload"
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for S1)"
  [ -f "$sf" ]

  local line_count
  line_count="$(wc -l < "$sf")"
  [ "$line_count" -eq 1 ]

  local line
  line="$(head -1 "$sf")"
  # id, status
  [ "$(printf '%s' "$line" | jq -r '.id')"     = "toolu_ABC" ]
  [ "$(printf '%s' "$line" | jq -r '.status')" = "running"   ]
  # spec-mandated field names: type, desc, started (ISO8601 with TZ offset)
  [ "$(printf '%s' "$line" | jq -r '.type')"   = "sdd-spec"  ]
  [ "$(printf '%s' "$line" | jq -r '.desc')"   = "Write spec" ]
  local started
  started="$(printf '%s' "$line" | jq -r '.started')"
  [ -n "$started" ]
  # ISO8601 with timezone offset: YYYY-MM-DDTHH:MM:SS+HH:MM or -HH:MM
  [[ "$started" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$ ]]
}

# ---------------------------------------------------------------------------
# Test 2: empty stdin — no write, exit 0
# ---------------------------------------------------------------------------
@test "pre: empty stdin — exits 0, no state file created" {
  run run_pre ""
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for S_EMPTY)"
  [ ! -f "$sf" ]
}

# ---------------------------------------------------------------------------
# Test 3: malformed JSON — no write, exit 0
# ---------------------------------------------------------------------------
@test "pre: malformed JSON — exits 0, no state file created" {
  run run_pre "not-json"
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for S_MALFORMED)"
  [ ! -f "$sf" ]
}

# ---------------------------------------------------------------------------
# Test 4: missing session_id — no write, exit 0
# ---------------------------------------------------------------------------
@test "pre: missing session_id — exits 0, no file created" {
  run run_pre '{"tool_use_id":"toolu_X"}'
  [ "$status" -eq 0 ]
  # No file should be created for any session since session_id was empty
  [ -z "$(ls "$HOME/.claude/state/" 2>/dev/null)" ]
}

# ---------------------------------------------------------------------------
# Test 5: missing tool_use_id — no write, exit 0
# ---------------------------------------------------------------------------
@test "pre: missing tool_use_id — exits 0, no file created" {
  run run_pre '{"session_id":"S_NOID"}'
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for S_NOID)"
  [ ! -f "$sf" ]
}

# ---------------------------------------------------------------------------
# Test 6: missing subagent_type — still writes, subagent_type is empty string
# ---------------------------------------------------------------------------
@test "pre: missing subagent_type — writes line with empty type" {
  local payload='{"tool_use_id":"toolu_NOSA","session_id":"S_NOSA"}'
  run run_pre "$payload"
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for S_NOSA)"
  [ -f "$sf" ]

  local line
  line="$(head -1 "$sf")"
  [ "$(printf '%s' "$line" | jq -r '.id')"     = "toolu_NOSA" ]
  [ "$(printf '%s' "$line" | jq -r '.status')" = "running"    ]
  # type field must be present; empty string when subagent_type absent
  local tp
  tp="$(printf '%s' "$line" | jq -r '.type // ""')"
  [ "$tp" = "" ]
}

# ---------------------------------------------------------------------------
# Test 7: two pre calls, same session — state file has 2 lines, both running
# ---------------------------------------------------------------------------
@test "pre: two calls same session — state file has 2 running lines" {
  local p1='{"tool_use_id":"toolu_1","session_id":"SAME","tool_input":{"subagent_type":"a"}}'
  local p2='{"tool_use_id":"toolu_2","session_id":"SAME","tool_input":{"subagent_type":"b"}}'

  run run_pre "$p1"; [ "$status" -eq 0 ]
  run run_pre "$p2"; [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for SAME)"
  [ -f "$sf" ]

  local line_count
  line_count="$(wc -l < "$sf")"
  [ "$line_count" -eq 2 ]

  local running_count
  running_count="$(jq -s '[.[] | select(.status=="running")] | length' "$sf")"
  [ "$running_count" -eq 2 ]
}

# ---------------------------------------------------------------------------
# Test 8: two pre calls, different sessions — two separate state files
# ---------------------------------------------------------------------------
@test "pre: two calls different sessions — two separate JSONL files" {
  local p1='{"tool_use_id":"toolu_A","session_id":"SES_A","tool_input":{"subagent_type":"a"}}'
  local p2='{"tool_use_id":"toolu_B","session_id":"SES_B","tool_input":{"subagent_type":"b"}}'

  run run_pre "$p1"; [ "$status" -eq 0 ]
  run run_pre "$p2"; [ "$status" -eq 0 ]

  local sf_a sf_b
  sf_a="$(state_file_for SES_A)"
  sf_b="$(state_file_for SES_B)"

  [ -f "$sf_a" ]
  [ -f "$sf_b" ]

  # Each file has exactly 1 line
  [ "$(wc -l < "$sf_a")" -eq 1 ]
  [ "$(wc -l < "$sf_b")" -eq 1 ]
}

# ---------------------------------------------------------------------------
# Test 9: line size sanity — written line is < 4096 bytes (atomicity guarantee)
# ---------------------------------------------------------------------------
@test "pre: line size sanity — written line < 4096 bytes" {
  local payload='{"tool_use_id":"toolu_SIZE","session_id":"S_SIZE","tool_input":{"subagent_type":"sdd-apply","description":"Size test"}}'
  run run_pre "$payload"
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for S_SIZE)"
  [ -f "$sf" ]

  local byte_count
  byte_count="$(wc -c < "$sf")"
  [ "$byte_count" -lt 4096 ]
}
