#!/usr/bin/env bats
# tests/track-delegation-fail.bats — REQ-HOOKS-005, REQ-TRACK-FAIL-001, REQ-TRACK-FAIL-002
# EMPIRICAL: verify in Batch 3 — PostToolUseFailure payload shape assumed per design B.3.

load helpers

# ---------------------------------------------------------------------------
# Test 1: happy path — writes failed entry to both counter and history
# ---------------------------------------------------------------------------
@test "fail: happy path — writes failed entry to counter and history" {
  # Run pre first so counter file exists
  local pre_payload='{"tool_use_id":"toolu_F1","session_id":"SF1","tool_input":{"subagent_type":"sdd-spec","description":"fail test","prompt":"p"},"cwd":"/f"}'
  run_pre "$pre_payload"

  local fail_payload='{"tool_use_id":"toolu_F1","session_id":"SF1"}'
  run run_fail "$fail_payload"
  [ "$status" -eq 0 ]

  # Counter file: last line is {id, ended, status:"failed"}
  local sf
  sf="$(state_file_for SF1)"
  [ -f "$sf" ]

  local last_counter
  last_counter="$(tail -1 "$sf")"
  [ "$(printf '%s' "$last_counter" | jq -r '.id')"     = "toolu_F1" ]
  [ "$(printf '%s' "$last_counter" | jq -r '.status')" = "failed"   ]

  local ended
  ended="$(printf '%s' "$last_counter" | jq -r '.ended')"
  [ -n "$ended" ]
  [[ "$ended" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$ ]]

  # History file: last line is the failed entry
  local hf
  hf="$(history_file_for)"
  [ -f "$hf" ]

  local hist_entry
  hist_entry="$(tail -1 "$hf")"
  [ "$(printf '%s' "$hist_entry" | jq -r '.tool_use_id')"    = "toolu_F1" ]
  [ "$(printf '%s' "$hist_entry" | jq -r '.status')"         = "failed"   ]
  [ "$(printf '%s' "$hist_entry" | jq -r '.duration_ms')"    = "null"     ]
  [ "$(printf '%s' "$hist_entry" | jq -r '.total_cost_usd')" = "null"     ]
  [ "$(printf '%s' "$hist_entry" | jq -r '.usage')"          = "null"     ]
}

# ---------------------------------------------------------------------------
# Test 2: missing counter file — exits 0, counter NOT created, history IS created
# (design decision: history is global and records the failure even if pre never fired)
# ---------------------------------------------------------------------------
@test "fail: missing counter file — exits 0, history created, counter NOT created" {
  # No run_pre — counter file does not exist
  local fail_payload='{"tool_use_id":"toolu_F2","session_id":"SF2"}'
  run run_fail "$fail_payload"
  [ "$status" -eq 0 ]

  # Counter file must NOT be created (no pre means no session counter)
  local sf
  sf="$(state_file_for SF2)"
  [ ! -f "$sf" ]

  # History file MUST be created (failure recorded globally)
  local hf
  hf="$(history_file_for)"
  [ -f "$hf" ]

  local hist_entry
  hist_entry="$(grep '"toolu_F2"' "$hf")"
  [ -n "$hist_entry" ]
  [ "$(printf '%s' "$hist_entry" | jq -r '.status')" = "failed" ]
}

# ---------------------------------------------------------------------------
# Test 3: empty stdin — exit 0, no writes
# ---------------------------------------------------------------------------
@test "fail: empty stdin — exits 0, no counter, no history" {
  run run_fail ""
  [ "$status" -eq 0 ]

  # No counter files
  [ -z "$(ls "$HOME/.claude/state/"delegations-*.jsonl 2>/dev/null || true)" ]

  # No history file
  local hf
  hf="$(history_file_for)"
  [ ! -f "$hf" ]
}

# ---------------------------------------------------------------------------
# Test 4: missing session_id — exit 0, no writes
# ---------------------------------------------------------------------------
@test "fail: missing session_id — exits 0, no writes" {
  local fail_payload='{"tool_use_id":"toolu_F4"}'
  run run_fail "$fail_payload"
  [ "$status" -eq 0 ]

  # No counter files
  [ -z "$(ls "$HOME/.claude/state/"delegations-*.jsonl 2>/dev/null || true)" ]

  # No history file (missing session_id means we exit early before any write)
  local hf
  hf="$(history_file_for)"
  [ ! -f "$hf" ]
}

# ---------------------------------------------------------------------------
# Test 5: missing tool_use_id — exit 0, no writes
# ---------------------------------------------------------------------------
@test "fail: missing tool_use_id — exits 0, no writes" {
  local fail_payload='{"session_id":"SF5"}'
  run run_fail "$fail_payload"
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for SF5)"
  [ ! -f "$sf" ]

  local hf
  hf="$(history_file_for)"
  [ ! -f "$hf" ]
}
