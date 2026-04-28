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

# ---------------------------------------------------------------------------
# Phase 3 tests — history writes (REQ-HOOKS-006, REQ-HISTORY-002, REQ-HISTORY-004,
#                                   REQ-HISTORY-006, REQ-HISTORY-008)
# ---------------------------------------------------------------------------

@test "pre: also writes history seed entry to history file" {
  local payload='{"tool_use_id":"toolu_H1","session_id":"SH1","tool_input":{"subagent_type":"sdd-spec","description":"Write spec","prompt":"do the thing"},"cwd":"/project"}'
  run run_pre "$payload"
  [ "$status" -eq 0 ]

  local hf
  hf="$(history_file_for)"
  [ -f "$hf" ]

  # Exactly one history line
  local hcount
  hcount="$(wc -l < "$hf")"
  [ "$hcount" -eq 1 ]

  local entry
  entry="$(head -1 "$hf")"

  # All 12 required fields
  [ "$(printf '%s' "$entry" | jq -r '.session_id')"     = "SH1"       ]
  [ "$(printf '%s' "$entry" | jq -r '.tool_use_id')"    = "toolu_H1"  ]
  [ "$(printf '%s' "$entry" | jq -r '.subagent_type')"  = "sdd-spec"  ]
  [ "$(printf '%s' "$entry" | jq -r '.description')"    = "Write spec" ]
  [ "$(printf '%s' "$entry" | jq -r '.prompt')"         = "do the thing" ]
  [ "$(printf '%s' "$entry" | jq -r '.status')"         = "running"   ]
  [ "$(printf '%s' "$entry" | jq -r '.cwd')"            = "/project"  ]
  [ "$(printf '%s' "$entry" | jq -r '.ended')"          = "null"      ]
  [ "$(printf '%s' "$entry" | jq -r '.duration_ms')"    = "null"      ]
  [ "$(printf '%s' "$entry" | jq -r '.total_cost_usd')" = "null"      ]
  [ "$(printf '%s' "$entry" | jq -r '.usage')"          = "null"      ]

  # started must be non-empty ISO8601
  local started
  started="$(printf '%s' "$entry" | jq -r '.started')"
  [ -n "$started" ]
}

@test "pre: history entry preserves multiline prompt with quotes" {
  local tricky_prompt
  tricky_prompt='Line one
Line two with "quotes" and backslash \'

  local payload
  payload="$(jq -cn \
    --arg session_id  "SH_RT" \
    --arg tool_use_id "toolu_RT" \
    --arg prompt      "$tricky_prompt" \
    '{
      session_id:  $session_id,
      tool_use_id: $tool_use_id,
      tool_input: {
        subagent_type: "test",
        description: "roundtrip",
        prompt: $prompt
      },
      cwd: "/tmp"
    }')"

  run run_pre "$payload"
  [ "$status" -eq 0 ]

  local hf
  hf="$(history_file_for)"
  [ -f "$hf" ]

  local retrieved
  retrieved="$(tail -1 "$hf" | jq -r '.prompt')"
  [ "$retrieved" = "$tricky_prompt" ]

  # Must be valid JSON
  tail -1 "$hf" | jq -c . > /dev/null
}

@test "pre: history entry goes to CLAUDE_PLUGIN_DATA path when env is set" {
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/pdata"
  local payload='{"tool_use_id":"toolu_PD","session_id":"SPD","tool_input":{"subagent_type":"sdd-apply","description":"pd test","prompt":"p"},"cwd":"/x"}'
  run run_pre "$payload"
  [ "$status" -eq 0 ]

  local expected_hf="$BATS_TEST_TMPDIR/pdata/history.jsonl"
  [ -f "$expected_hf" ]

  # Must NOT be at fallback path
  [ ! -f "$HOME/.claude/state/delegation-history.jsonl" ]

  local entry
  entry="$(head -1 "$expected_hf")"
  [ "$(printf '%s' "$entry" | jq -r '.tool_use_id')" = "toolu_PD" ]
}

@test "pre: history entry uses fallback path when CLAUDE_PLUGIN_DATA not set" {
  unset CLAUDE_PLUGIN_DATA
  local payload='{"tool_use_id":"toolu_FB","session_id":"SFB","tool_input":{"subagent_type":"sdd-apply","description":"fb","prompt":"p"},"cwd":"/x"}'
  run run_pre "$payload"
  [ "$status" -eq 0 ]

  local expected_hf="$HOME/.claude/state/delegation-history.jsonl"
  [ -f "$expected_hf" ]

  local entry
  entry="$(head -1 "$expected_hf")"
  [ "$(printf '%s' "$entry" | jq -r '.tool_use_id')" = "toolu_FB" ]
}

@test "pre: counter file shape unchanged after history addition (regression)" {
  local payload='{"tool_use_id":"toolu_CREG","session_id":"SCREG","tool_input":{"subagent_type":"sdd-spec","description":"Desc"},"cwd":"/y"}'
  run run_pre "$payload"
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for SCREG)"
  [ -f "$sf" ]

  # Counter file first line must have exactly the v0.1 lean shape:
  # {id, type, desc, started, status:"running"} — NO history fields
  local line
  line="$(head -1 "$sf")"

  [ "$(printf '%s' "$line" | jq -r '.id')"     = "toolu_CREG" ]
  [ "$(printf '%s' "$line" | jq -r '.type')"   = "sdd-spec"   ]
  [ "$(printf '%s' "$line" | jq -r '.desc')"   = "Desc"       ]
  [ "$(printf '%s' "$line" | jq -r '.status')" = "running"    ]
  # Lean counter must NOT have these full-fat history fields
  [ "$(printf '%s' "$line" | jq '.prompt')"        = "null" ]
  [ "$(printf '%s' "$line" | jq '.session_id')"    = "null" ]
  [ "$(printf '%s' "$line" | jq '.tool_use_id')"   = "null" ]
  [ "$(printf '%s' "$line" | jq '.total_cost_usd')" = "null" ]
}
