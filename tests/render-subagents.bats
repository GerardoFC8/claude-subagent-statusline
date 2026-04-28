#!/usr/bin/env bats
# tests/render-subagents.bats — render-subagents.sh unit tests

load helpers

RENDERER="$REPO_ROOT/scripts/render-subagents.sh"

# Helper: write a history entry for a completed delegation
write_history_done() {
  local hf tool_use_id session_id subagent_type description started ended duration_ms input_tokens output_tokens
  hf="$(history_file_for)"
  tool_use_id="$1"
  session_id="$2"
  subagent_type="$3"
  description="$4"
  started="$5"
  ended="$6"
  duration_ms="$7"
  input_tokens="$8"
  output_tokens="$9"

  # Seed entry (running)
  jq -cn \
    --arg sid "$session_id" --arg tid "$tool_use_id" --arg st "$subagent_type" \
    --arg desc "$description" --arg started "$started" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:$st, description:$desc,
      prompt:"test prompt", started:$started, ended:null, duration_ms:null,
      status:"running", total_cost_usd:null, usage:null, cwd:"/tmp"}' >> "$hf"

  # Finalization entry (done)
  jq -cn \
    --arg sid "$session_id" --arg tid "$tool_use_id" --arg ended "$ended" \
    --argjson dms "$duration_ms" --argjson it "$input_tokens" --argjson ot "$output_tokens" \
    '{session_id:$sid, tool_use_id:$tid, ended:$ended, duration_ms:$dms,
      status:"done", total_cost_usd:null,
      usage:{input_tokens:$it, output_tokens:$ot}, response:null}' >> "$hf"
}

# Helper: write a failed history entry (only seed, no finalization — simulates pre-hook + fail hook)
write_history_failed() {
  local hf tool_use_id session_id subagent_type description started
  hf="$(history_file_for)"
  tool_use_id="$1"
  session_id="$2"
  subagent_type="$3"
  description="$4"
  started="$5"

  # Seed entry (running)
  jq -cn \
    --arg sid "$session_id" --arg tid "$tool_use_id" --arg st "$subagent_type" \
    --arg desc "$description" --arg started "$started" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:$st, description:$desc,
      prompt:"test prompt", started:$started, ended:null, duration_ms:null,
      status:"running", total_cost_usd:null, usage:null, cwd:"/tmp"}' >> "$hf"

  # Failed finalization
  jq -cn \
    --arg sid "$session_id" --arg tid "$tool_use_id" --arg ended "$(date -Iseconds)" \
    '{session_id:$sid, tool_use_id:$tid, ended:$ended, duration_ms:null,
      status:"failed", total_cost_usd:null, usage:null}' >> "$hf"
}

# Helper: write a "running" seed entry only (no finalization)
write_history_running() {
  local hf tool_use_id session_id subagent_type description started
  hf="$(history_file_for)"
  tool_use_id="$1"
  session_id="$2"
  subagent_type="$3"
  description="$4"
  started="$5"

  jq -cn \
    --arg sid "$session_id" --arg tid "$tool_use_id" --arg st "$subagent_type" \
    --arg desc "$description" --arg started "$started" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:$st, description:$desc,
      prompt:"test prompt", started:$started, ended:null, duration_ms:null,
      status:"running", total_cost_usd:null, usage:null, cwd:"/tmp"}' >> "$hf"
}

# ---------------------------------------------------------------------------
# Test 1: empty history → empty-state message
# ---------------------------------------------------------------------------
@test "render-subagents: empty history file prints empty-state message" {
  run "$RENDERER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No delegations recorded yet."* ]]
}

@test "render-subagents: missing history file prints empty-state message" {
  # No history file created — should still exit 0 with empty-state
  run "$RENDERER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No delegations recorded yet."* ]]
}

# ---------------------------------------------------------------------------
# Test 2: 3 entries → table with 3 rows + headers
# ---------------------------------------------------------------------------
@test "render-subagents: 3 done entries render table with headers and 3 rows" {
  local ts
  ts="$(date -Iseconds)"
  write_history_done "toolu_1" "SES_A" "sdd-spec"   "Write spec for auth"    "$ts" "$ts" 72000  3200 8400
  write_history_done "toolu_2" "SES_A" "sdd-design"  "Lock contracts"         "$ts" "$ts" 18000  1200 2800
  write_history_done "toolu_3" "SES_A" "sdd-apply"   "Implement auth module"  "$ts" "$ts" 120000 5000 12000

  run "$RENDERER"
  [ "$status" -eq 0 ]

  # Table headers
  [[ "$output" == *"| #"* ]]
  [[ "$output" == *"Type"* ]]
  [[ "$output" == *"Description"* ]]
  [[ "$output" == *"Status"* ]]
  [[ "$output" == *"Duration"* ]]
  [[ "$output" == *"Tokens"* ]]

  # 3 entries must appear (numbered 1 2 3)
  [[ "$output" == *"| 1 "* ]] || [[ "$output" == *"| 1|"* ]] || [[ "$output" == *" 1 |"* ]]
  [[ "$output" == *"| 2 "* ]] || [[ "$output" == *"| 2|"* ]] || [[ "$output" == *" 2 |"* ]]
  [[ "$output" == *"| 3 "* ]] || [[ "$output" == *"| 3|"* ]] || [[ "$output" == *" 3 |"* ]]
}

# ---------------------------------------------------------------------------
# Test 3: stats mode aggregates correctly
# ---------------------------------------------------------------------------
@test "render-subagents: stats mode shows session aggregates" {
  local ts
  ts="$(date -Iseconds)"
  write_history_done "toolu_s1" "SES_STATS" "sdd-spec"  "Spec A"   "$ts" "$ts" 60000 1000 2000
  write_history_done "toolu_s2" "SES_STATS" "sdd-spec"  "Spec B"   "$ts" "$ts" 90000 1500 3000
  write_history_done "toolu_s3" "SES_STATS" "sdd-apply" "Apply C"  "$ts" "$ts" 45000 800  1600

  run "$RENDERER" "stats" "SES_STATS"
  [ "$status" -eq 0 ]

  # Should show total count
  [[ "$output" == *"3"* ]]
  # Should show by-type grouping
  [[ "$output" == *"sdd-spec"* ]]
  [[ "$output" == *"sdd-apply"* ]]
}

# ---------------------------------------------------------------------------
# Test 4: hard cap at 100
# ---------------------------------------------------------------------------
@test "render-subagents: hard cap at 100 rows even with large N argument" {
  local ts hf
  ts="$(date -Iseconds)"
  hf="$(history_file_for)"

  # Write 110 entries
  for i in $(seq 1 110); do
    jq -cn \
      --arg tid "toolu_cap_${i}" --arg sid "SES_CAP" --arg idx "$i" \
      '{session_id:$sid, tool_use_id:$tid, subagent_type:"sdd-spec",
        description:("Entry " + $idx), prompt:"p", started:"2026-04-28T10:00:00+00:00",
        ended:"2026-04-28T10:01:00+00:00", duration_ms:60000, status:"done",
        total_cost_usd:null, usage:{input_tokens:100, output_tokens:200}, response:null}' >> "$hf"
  done

  run "$RENDERER" "99999"
  [ "$status" -eq 0 ]

  # Count rows (lines containing "| N " pattern — must be ≤ 100)
  local row_count
  row_count="$(printf '%s' "$output" | grep -cE '^\| [0-9]' || true)"
  [ "$row_count" -le 100 ]
}

# ---------------------------------------------------------------------------
# Test 5: regression — entry with running+done only (no failed counterpart)
# This is the v0.2.1 bug pattern: a successful delegation has running+done but no failed.
# The fold pipeline must NOT collapse this entry.
# ---------------------------------------------------------------------------
@test "render-subagents: regression — successful delegation (running+done, no failed) appears in table" {
  local ts
  ts="$(date -Iseconds)"
  # Only write a done delegation — no failed entry for this tool_use_id
  write_history_done "toolu_success" "SES_REG" "sdd-spec" "Write spec for X" "$ts" "$ts" 30000 500 1000

  run "$RENDERER"
  [ "$status" -eq 0 ]

  # The entry must appear in the table, not be collapsed
  [[ "$output" == *"sdd-spec"* ]]
  [[ "$output" == *"Write spec for X"* ]] || [[ "$output" == *"Write spec for"* ]]
  # Status must be "done", not blank/missing
  [[ "$output" == *"done"* ]]
}

# ---------------------------------------------------------------------------
# Test 6: entry with only running (no done or failed) — shows as running
# ---------------------------------------------------------------------------
@test "render-subagents: running-only entry shows status running in table" {
  local ts
  ts="$(date -Iseconds)"
  write_history_running "toolu_run" "SES_RUN" "general-purpose" "Ongoing task" "$ts"

  run "$RENDERER"
  [ "$status" -eq 0 ]

  [[ "$output" == *"general-purpose"* ]]
  [[ "$output" == *"running"* ]]
}

# ---------------------------------------------------------------------------
# Test 7: N argument limits table rows
# ---------------------------------------------------------------------------
@test "render-subagents: N=2 argument limits table to 2 rows" {
  local ts
  ts="$(date -Iseconds)"
  write_history_done "toolu_n1" "SES_N" "sdd-spec"   "Task one"   "$ts" "$ts" 10000 100 200
  write_history_done "toolu_n2" "SES_N" "sdd-design"  "Task two"   "$ts" "$ts" 20000 200 400
  write_history_done "toolu_n3" "SES_N" "sdd-apply"   "Task three" "$ts" "$ts" 30000 300 600

  run "$RENDERER" "2"
  [ "$status" -eq 0 ]

  # Should have rows 1 and 2 but NOT 3
  local row_count
  row_count="$(printf '%s' "$output" | grep -cE '^\| [0-9]' || true)"
  [ "$row_count" -eq 2 ]
}

# ---------------------------------------------------------------------------
# Test 8: CLAUDE_PLUGIN_DATA path takes precedence over fallback
# ---------------------------------------------------------------------------
@test "render-subagents: respects CLAUDE_PLUGIN_DATA for history path" {
  local custom_dir
  custom_dir="$BATS_TEST_TMPDIR/custom_data"
  mkdir -p "$custom_dir"
  export CLAUDE_PLUGIN_DATA="$custom_dir"

  local ts
  ts="$(date -Iseconds)"
  # Write directly to custom path
  jq -cn \
    --arg tid "toolu_cpd" --arg sid "SES_CPD" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:"sdd-spec",
      description:"Custom path test", prompt:"p", started:"2026-04-28T10:00:00+00:00",
      ended:"2026-04-28T10:01:00+00:00", duration_ms:60000, status:"done",
      total_cost_usd:null, usage:{input_tokens:100, output_tokens:200}, response:null}' \
    >> "$custom_dir/history.jsonl"

  run "$RENDERER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Custom path test"* ]]
}

# ---------------------------------------------------------------------------
# v0.3.1 — Convention path tests (fix/render-subagents-path-resolution)
# REQ-RENDER-PATH-001: reads from convention path when CLAUDE_PLUGIN_DATA unset
# REQ-RENDER-PATH-002: CLAUDE_PLUGIN_DATA takes precedence over convention path
# REQ-RENDER-PATH-003: falls back to legacy path when upper paths absent/empty
# ---------------------------------------------------------------------------

@test "render-subagents: reads from convention path when CLAUDE_PLUGIN_DATA unset" {
  unset CLAUDE_PLUGIN_DATA

  # Create convention path dir and populate it
  local convention_dir
  convention_dir="$HOME/.claude/plugins/data/claude-subagent-statusline-claude-subagent-statusline"
  mkdir -p "$convention_dir"

  jq -cn \
    --arg tid "toolu_conv" --arg sid "SES_CONV" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:"sdd-apply",
      description:"Convention path delegation", prompt:"p",
      started:"2026-04-28T10:00:00+00:00",
      ended:"2026-04-28T10:01:00+00:00", duration_ms:60000, status:"done",
      total_cost_usd:null, usage:{input_tokens:100, output_tokens:200}, response:null}' \
    >> "$convention_dir/history.jsonl"

  # Legacy path must be absent or empty (clean HOME already has no file there)

  run "$RENDERER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Convention path delegation"* ]]
}

@test "render-subagents: reads from CLAUDE_PLUGIN_DATA when set, ignores convention path" {
  local custom_dir convention_dir
  custom_dir="$BATS_TEST_TMPDIR/env_data"
  mkdir -p "$custom_dir"
  export CLAUDE_PLUGIN_DATA="$custom_dir"

  # Populate ONLY the env-set path
  jq -cn \
    --arg tid "toolu_env" --arg sid "SES_ENV" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:"sdd-spec",
      description:"Env path delegation", prompt:"p",
      started:"2026-04-28T10:00:00+00:00",
      ended:"2026-04-28T10:01:00+00:00", duration_ms:30000, status:"done",
      total_cost_usd:null, usage:{input_tokens:50, output_tokens:100}, response:null}' \
    >> "$custom_dir/history.jsonl"

  # Populate convention path with DIFFERENT data — must NOT appear in output
  convention_dir="$HOME/.claude/plugins/data/claude-subagent-statusline-claude-subagent-statusline"
  mkdir -p "$convention_dir"
  jq -cn \
    '{session_id:"SES_CONV2", tool_use_id:"toolu_conv2", subagent_type:"sdd-tasks",
      description:"Should not appear", prompt:"p",
      started:"2026-04-28T09:00:00+00:00",
      ended:"2026-04-28T09:01:00+00:00", duration_ms:10000, status:"done",
      total_cost_usd:null, usage:{input_tokens:10, output_tokens:20}, response:null}' \
    >> "$convention_dir/history.jsonl"

  run "$RENDERER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Env path delegation"* ]]
  [[ "$output" != *"Should not appear"* ]]
}

@test "render-subagents: falls back to legacy path when both upper paths empty or missing" {
  unset CLAUDE_PLUGIN_DATA
  # Ensure convention dir does NOT exist
  rm -rf "$HOME/.claude/plugins" 2>/dev/null || true

  # Populate legacy path only
  local legacy_file="$HOME/.claude/state/delegation-history.jsonl"
  jq -cn \
    --arg tid "toolu_leg" --arg sid "SES_LEG" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:"sdd-verify",
      description:"Legacy path delegation", prompt:"p",
      started:"2026-04-28T10:00:00+00:00",
      ended:"2026-04-28T10:01:00+00:00", duration_ms:45000, status:"done",
      total_cost_usd:null, usage:{input_tokens:200, output_tokens:400}, response:null}' \
    >> "$legacy_file"

  run "$RENDERER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Legacy path delegation"* ]]
}
