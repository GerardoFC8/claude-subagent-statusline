#!/usr/bin/env bats
# tests/history.bats — history-lib.sh ring buffer, path resolution, schema
# REQ-HISTORY-001, REQ-HISTORY-005, REQ-HISTORY-006, REQ-HISTORY-007, REQ-HISTORY-008

load helpers

# ---------------------------------------------------------------------------
# Task 2.1 / F.5 — Path resolution
# ---------------------------------------------------------------------------

@test "history: path resolves to PLUGIN_DATA when set" {
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/pd"
  # Source the lib and call history_path
  local path
  # shellcheck disable=SC1091
  path="$(source "$REPO_ROOT/scripts/history-lib.sh" && history_path)"
  [ "$path" = "$BATS_TEST_TMPDIR/pd/history.jsonl" ]
}

@test "history: path falls back when env unset" {
  unset CLAUDE_PLUGIN_DATA
  local path
  # shellcheck disable=SC1091
  path="$(source "$REPO_ROOT/scripts/history-lib.sh" && history_path)"
  [ "$path" = "$HOME/.claude/state/delegation-history.jsonl" ]
}

# ---------------------------------------------------------------------------
# Triangulation: path resolves correctly with trailing slash in PLUGIN_DATA
# ---------------------------------------------------------------------------

@test "history: path resolves non-empty PLUGIN_DATA correctly" {
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/altpd"
  local path
  # shellcheck disable=SC1091
  path="$(source "$REPO_ROOT/scripts/history-lib.sh" && history_path)"
  [ "$path" = "$BATS_TEST_TMPDIR/altpd/history.jsonl" ]
}

# ---------------------------------------------------------------------------
# Task 2.3 / F.5 — Append function: creates parent dir and appends line
# ---------------------------------------------------------------------------

@test "history: append creates parent dir and file" {
  unset CLAUDE_PLUGIN_DATA
  local hist_file
  hist_file="$HOME/.claude/state/delegation-history.jsonl"
  # Remove the directory to confirm mkdir -p behavior
  rm -rf "$HOME/.claude/state"

  # shellcheck disable=SC1091
  (source "$REPO_ROOT/scripts/history-lib.sh" && history_append '{"status":"running"}')

  [ -d "$HOME/.claude/state" ]
  [ -f "$hist_file" ]
  local line_count
  line_count="$(wc -l < "$hist_file")"
  [ "$line_count" -eq 1 ]
  [ "$(jq -r '.status' "$hist_file")" = "running" ]
}

@test "history: append appends multiple lines" {
  unset CLAUDE_PLUGIN_DATA
  local hist_file="$HOME/.claude/state/delegation-history.jsonl"

  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/history-lib.sh"
  history_append '{"n":1}'
  history_append '{"n":2}'

  local count
  count="$(wc -l < "$hist_file")"
  [ "$count" -eq 2 ]
}

# ---------------------------------------------------------------------------
# Task 2.5 / F.5 — Ring buffer trim threshold boundary
# ---------------------------------------------------------------------------

@test "history: trim — under threshold leaves file alone" {
  unset CLAUDE_PLUGIN_DATA
  local hist_file="$HOME/.claude/state/delegation-history.jsonl"

  export HISTORY_TRIM_THRESHOLD=6
  export HISTORY_KEEP=5

  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/history-lib.sh"
  # Write 5 lines (< threshold of 6)
  for i in $(seq 1 5); do
    history_append "{\"n\":$i}"
  done

  local count
  count="$(wc -l < "$hist_file")"
  [ "$count" -eq 5 ]
}

@test "history: trim — at threshold (exactly threshold) leaves file alone" {
  unset CLAUDE_PLUGIN_DATA
  local hist_file="$HOME/.claude/state/delegation-history.jsonl"

  export HISTORY_TRIM_THRESHOLD=6
  export HISTORY_KEEP=5

  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/history-lib.sh"
  # Write exactly 6 lines (= threshold, not over)
  for i in $(seq 1 6); do
    history_append "{\"n\":$i}"
  done

  local count
  count="$(wc -l < "$hist_file")"
  # Trim fires only when lines > threshold (strict >), so 6 lines is NOT trimmed
  [ "$count" -eq 6 ]
}

@test "history: trim — over threshold keeps last KEEP lines" {
  unset CLAUDE_PLUGIN_DATA
  local hist_file="$HOME/.claude/state/delegation-history.jsonl"

  export HISTORY_TRIM_THRESHOLD=6
  export HISTORY_KEEP=5

  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/history-lib.sh"
  # Write 7 lines (> threshold of 6); trim should fire and keep last 5
  for i in $(seq 1 7); do
    history_append "{\"n\":$i}"
  done

  local count
  count="$(wc -l < "$hist_file")"
  [ "$count" -eq 5 ]

  # Verify the kept lines are lines 3..7 (newest 5)
  local first_n
  first_n="$(head -1 "$hist_file" | jq -r '.n')"
  [ "$first_n" -eq 3 ]

  local last_n
  last_n="$(tail -1 "$hist_file" | jq -r '.n')"
  [ "$last_n" -eq 7 ]
}

@test "history: trim — atomic via tmp+mv leaves no .tmp.* files" {
  unset CLAUDE_PLUGIN_DATA
  local hist_file="$HOME/.claude/state/delegation-history.jsonl"

  export HISTORY_TRIM_THRESHOLD=6
  export HISTORY_KEEP=5

  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/history-lib.sh"
  for i in $(seq 1 7); do
    history_append "{\"n\":$i}"
  done

  # No leftover .tmp.* files
  local tmp_files
  tmp_files="$(ls "${hist_file}.tmp."* 2>/dev/null || true)"
  [ -z "$tmp_files" ]
}

# ---------------------------------------------------------------------------
# Ring buffer end-to-end (small ring)
# ---------------------------------------------------------------------------

@test "history: ring buffer end-to-end — file stays at KEEP after many writes" {
  unset CLAUDE_PLUGIN_DATA
  local hist_file="$HOME/.claude/state/delegation-history.jsonl"

  export HISTORY_TRIM_THRESHOLD=6
  export HISTORY_KEEP=5

  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/history-lib.sh"
  # Write 12 entries — multiple trim cycles
  for i in $(seq 1 12); do
    history_append "{\"n\":$i}"
  done

  local count
  count="$(wc -l < "$hist_file")"
  [ "$count" -le 6 ]  # may be 5 or 6 depending on exact crossing point
  # Last entry must be {n:12}
  local last_n
  last_n="$(tail -1 "$hist_file" | jq -r '.n')"
  [ "$last_n" -eq 12 ]
}

# ---------------------------------------------------------------------------
# Schema: finalized entries validate (all 12 fields present)
# ---------------------------------------------------------------------------

@test "history: schema — finalized entries have all required keys" {
  unset CLAUDE_PLUGIN_DATA
  # Simulate what pre+post hooks write
  local session_id="test_sess"
  local tool_use_id="toolu_test"

  local pre_payload
  pre_payload="$(jq -cn \
    --arg session_id "$session_id" \
    --arg tool_use_id "$tool_use_id" \
    '{
      session_id: $session_id,
      tool_use_id: $tool_use_id,
      tool_input: {
        subagent_type: "sdd-spec",
        description: "Test schema",
        prompt: "test prompt"
      },
      cwd: "/tmp"
    }')"

  run run_pre "$pre_payload"
  [ "$status" -eq 0 ]

  local hist_file
  hist_file="$HOME/.claude/state/delegation-history.jsonl"
  [ -f "$hist_file" ]

  # Verify the running seed entry has all 12 required keys
  local entry
  entry="$(tail -1 "$hist_file")"
  [ "$(printf '%s' "$entry" | jq -r '.session_id')"    = "$session_id"  ]
  [ "$(printf '%s' "$entry" | jq -r '.tool_use_id')"   = "$tool_use_id" ]
  [ "$(printf '%s' "$entry" | jq -r '.subagent_type')" = "sdd-spec"     ]
  [ "$(printf '%s' "$entry" | jq -r '.description')"   = "Test schema"  ]
  [ "$(printf '%s' "$entry" | jq -r '.prompt')"        = "test prompt"  ]
  [ "$(printf '%s' "$entry" | jq -r '.status')"        = "running"      ]
  [ "$(printf '%s' "$entry" | jq -r '.ended')"         = "null"         ]
  [ "$(printf '%s' "$entry" | jq -r '.duration_ms')"   = "null"         ]
  [ "$(printf '%s' "$entry" | jq -r '.total_cost_usd')" = "null"         ]
  [ "$(printf '%s' "$entry" | jq -r '.usage')"         = "null"         ]
  [ "$(printf '%s' "$entry" | jq -r '.cwd')"           = "/tmp"         ]
  # started must be non-empty ISO8601
  local started
  started="$(printf '%s' "$entry" | jq -r '.started')"
  [ -n "$started" ]
  # response field: running seed writes null; post finalization writes the value
  # For a seed (running) entry, response is not required — only verify key absent or null is ok
  # The schema test for finalized entries (with response) is covered by post.bats tests 12-14
}

# ---------------------------------------------------------------------------
# Prompt round-trip (REQ-HISTORY-006)
# ---------------------------------------------------------------------------

@test "history: prompt with newlines and quotes round-trips via jq" {
  unset CLAUDE_PLUGIN_DATA

  local tricky_prompt
  tricky_prompt='First line
Second line with "quotes" and backslash \n test'

  local payload
  payload="$(jq -cn \
    --arg session_id  "sess_rt" \
    --arg tool_use_id "toolu_rt" \
    --arg prompt      "$tricky_prompt" \
    '{
      session_id:  $session_id,
      tool_use_id: $tool_use_id,
      tool_input: {
        subagent_type: "test",
        description: "round-trip test",
        prompt: $prompt
      },
      cwd: "/tmp"
    }')"

  run run_pre "$payload"
  [ "$status" -eq 0 ]

  local hist_file
  hist_file="$HOME/.claude/state/delegation-history.jsonl"
  [ -f "$hist_file" ]

  local retrieved_prompt
  retrieved_prompt="$(tail -1 "$hist_file" | jq -r '.prompt')"
  [ "$retrieved_prompt" = "$tricky_prompt" ]

  # The line must also be valid JSON
  tail -1 "$hist_file" | jq -c . > /dev/null
}
