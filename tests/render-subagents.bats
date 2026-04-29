#!/usr/bin/env bats
# tests/render-subagents.bats — render-subagents.sh unit tests

load helpers

RENDERER="$REPO_ROOT/scripts/render-subagents.sh"

# Helper: write a history entry for a completed delegation (all 4 token fields)
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

# Helper: write a history entry with all 4 token fields
write_history_done_full_tokens() {
  local hf tool_use_id session_id subagent_type description started ended duration_ms \
        input_tokens cache_read cache_creation output_tokens
  hf="$(history_file_for)"
  tool_use_id="$1"
  session_id="$2"
  subagent_type="$3"
  description="$4"
  started="$5"
  ended="$6"
  duration_ms="$7"
  input_tokens="$8"
  cache_read="$9"
  cache_creation="${10}"
  output_tokens="${11}"

  # Seed entry (running)
  jq -cn \
    --arg sid "$session_id" --arg tid "$tool_use_id" --arg st "$subagent_type" \
    --arg desc "$description" --arg started "$started" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:$st, description:$desc,
      prompt:"test prompt", started:$started, ended:null, duration_ms:null,
      status:"running", total_cost_usd:null, usage:null, cwd:"/tmp"}' >> "$hf"

  # Finalization entry (done) with all 4 fields
  jq -cn \
    --arg sid "$session_id" --arg tid "$tool_use_id" --arg ended "$ended" \
    --argjson dms "$duration_ms" \
    --argjson it "$input_tokens" --argjson cr "$cache_read" \
    --argjson cw "$cache_creation" --argjson ot "$output_tokens" \
    '{session_id:$sid, tool_use_id:$tid, ended:$ended, duration_ms:$dms,
      status:"done", total_cost_usd:null,
      usage:{input_tokens:$it, cache_read_input_tokens:$cr,
             cache_creation_input_tokens:$cw, output_tokens:$ot},
      response:null}' >> "$hf"
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
# Test 2: 3 entries (same session) → table with 4 token column headers + 3 rows
# ---------------------------------------------------------------------------
@test "render-subagents: 3 done entries render table with 4 token column headers and 3 rows" {
  local ts
  ts="$(date -Iseconds)"
  write_history_done "toolu_1" "SES_A" "sdd-spec"   "Write spec for auth"    "$ts" "$ts" 72000  3200 8400
  write_history_done "toolu_2" "SES_A" "sdd-design"  "Lock contracts"         "$ts" "$ts" 18000  1200 2800
  write_history_done "toolu_3" "SES_A" "sdd-apply"   "Implement auth module"  "$ts" "$ts" 120000 5000 12000

  run env CLAUDE_SESSION_ID="SES_A" "$RENDERER"
  [ "$status" -eq 0 ]

  # Table headers — 4 token columns instead of old single "Tokens"
  [[ "$output" == *"| #"* ]]
  [[ "$output" == *"Type"* ]]
  [[ "$output" == *"Description"* ]]
  [[ "$output" == *"Status"* ]]
  [[ "$output" == *"Duration"* ]]
  [[ "$output" == *"Input"* ]]
  [[ "$output" == *"CacheR"* ]]
  [[ "$output" == *"CacheW"* ]]
  [[ "$output" == *"Output"* ]]
  # Old single "Tokens" column must NOT appear
  [[ "$output" != *"| Tokens"* ]]

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

  # Write 110 entries all in the same session
  for i in $(seq 1 110); do
    jq -cn \
      --arg tid "toolu_cap_${i}" --arg sid "SES_CAP" --arg idx "$i" \
      '{session_id:$sid, tool_use_id:$tid, subagent_type:"sdd-spec",
        description:("Entry " + $idx), prompt:"p", started:"2026-04-28T10:00:00+00:00",
        ended:"2026-04-28T10:01:00+00:00", duration_ms:60000, status:"done",
        total_cost_usd:null, usage:{input_tokens:100, output_tokens:200}, response:null}' >> "$hf"
  done

  run env CLAUDE_SESSION_ID="SES_CAP" "$RENDERER" "99999"
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

  run env CLAUDE_SESSION_ID="SES_REG" "$RENDERER"
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

  run env CLAUDE_SESSION_ID="SES_RUN" "$RENDERER"
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

  run env CLAUDE_SESSION_ID="SES_N" "$RENDERER" "2"
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

  run env CLAUDE_SESSION_ID="SES_CPD" "$RENDERER"
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

  run env CLAUDE_SESSION_ID="SES_CONV" "$RENDERER"
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

  run env CLAUDE_SESSION_ID="SES_ENV" "$RENDERER"
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

  run env CLAUDE_SESSION_ID="SES_LEG" "$RENDERER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Legacy path delegation"* ]]
}

# ---------------------------------------------------------------------------
# v0.5.0 — Session filter tests
# ---------------------------------------------------------------------------

@test "render-subagents: default table shows only current session entries (CLAUDE_SESSION_ID)" {
  local ts
  ts="$(date -Iseconds)"
  # Session A (old session)
  write_history_done "toolu_old1" "SES_OLD" "sdd-spec"   "Old session task one"   "$ts" "$ts" 10000 100 200
  write_history_done "toolu_old2" "SES_OLD" "sdd-design" "Old session task two"   "$ts" "$ts" 20000 200 400
  # Session B (current session)
  write_history_done "toolu_cur1" "SES_CUR" "sdd-apply"  "Current session task"   "$ts" "$ts" 30000 300 600

  # Set CLAUDE_SESSION_ID to the current session
  run env CLAUDE_SESSION_ID="SES_CUR" "$RENDERER"
  [ "$status" -eq 0 ]

  # Current session entry must appear
  [[ "$output" == *"Current session task"* ]]
  # Old session entries must NOT appear
  [[ "$output" != *"Old session task one"* ]]
  [[ "$output" != *"Old session task two"* ]]
}

@test "render-subagents: default table uses heuristic (most recent session) when CLAUDE_SESSION_ID unset" {
  local ts
  ts="$(date -Iseconds)"
  local hf
  hf="$(history_file_for)"

  # Write old session entry with an older timestamp
  jq -cn \
    --arg tid "toolu_heur_old" --arg sid "SES_HEUR_OLD" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:"sdd-spec",
      description:"Heuristic old session", prompt:"p",
      started:"2024-01-01T10:00:00+00:00",
      ended:"2024-01-01T10:01:00+00:00", duration_ms:60000, status:"done",
      total_cost_usd:null, usage:{input_tokens:100, output_tokens:200}, response:null}' >> "$hf"

  # Write new session entry with a newer timestamp (will sort first after fold)
  jq -cn \
    --arg tid "toolu_heur_new" --arg sid "SES_HEUR_NEW" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:"sdd-apply",
      description:"Heuristic new session", prompt:"p",
      started:"2026-04-29T10:00:00+00:00",
      ended:"2026-04-29T10:01:00+00:00", duration_ms:30000, status:"done",
      total_cost_usd:null, usage:{input_tokens:50, output_tokens:100}, response:null}' >> "$hf"

  # CLAUDE_SESSION_ID explicitly unset
  run env -u CLAUDE_SESSION_ID "$RENDERER"
  [ "$status" -eq 0 ]

  # Should show the newest session's entries
  [[ "$output" == *"Heuristic new session"* ]]
  # Old session must NOT appear
  [[ "$output" != *"Heuristic old session"* ]]
}

@test "render-subagents: 'all' argument shows entries from all sessions" {
  local ts
  ts="$(date -Iseconds)"
  # Two different sessions
  write_history_done "toolu_all1" "SES_ALPHA" "sdd-spec"  "Alpha session task"   "$ts" "$ts" 10000 100 200
  write_history_done "toolu_all2" "SES_BETA"  "sdd-apply" "Beta session task"    "$ts" "$ts" 20000 200 400

  run "$RENDERER" "all"
  [ "$status" -eq 0 ]

  # Both sessions must appear
  [[ "$output" == *"Alpha session task"* ]]
  [[ "$output" == *"Beta session task"* ]]
}

@test "render-subagents: 'all N' argument respects N row limit across all sessions" {
  local ts
  ts="$(date -Iseconds)"
  write_history_done "toolu_lim1" "SES_X" "sdd-spec"   "Task X1" "$ts" "$ts" 10000 100 200
  write_history_done "toolu_lim2" "SES_X" "sdd-design" "Task X2" "$ts" "$ts" 20000 200 400
  write_history_done "toolu_lim3" "SES_Y" "sdd-apply"  "Task Y1" "$ts" "$ts" 30000 300 600

  run "$RENDERER" "all" "2"
  [ "$status" -eq 0 ]

  local row_count
  row_count="$(printf '%s' "$output" | grep -cE '^\| [0-9]' || true)"
  [ "$row_count" -eq 2 ]
}

@test "render-subagents: no matching session entries prints 'No delegations in this session yet'" {
  local ts
  ts="$(date -Iseconds)"
  # Write an entry for a different session
  write_history_done "toolu_other" "SES_OTHER" "sdd-spec" "Other session task" "$ts" "$ts" 10000 100 200

  # Set CLAUDE_SESSION_ID to a session with no entries
  run env CLAUDE_SESSION_ID="SES_EMPTY" "$RENDERER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No delegations in this session yet."* ]]
}

# ---------------------------------------------------------------------------
# v0.5.0 — 4-column token tests
# ---------------------------------------------------------------------------

@test "render-subagents: 4 token columns render expected values from full usage payload" {
  local ts
  ts="$(date -Iseconds)"
  # input=1, cache_read=55491, cache_creation=807, output=608
  write_history_done_full_tokens \
    "toolu_tok4" "SES_TOK" "general-purpose" "Token column test" \
    "$ts" "$ts" 7000 1 55491 807 608

  run env CLAUDE_SESSION_ID="SES_TOK" "$RENDERER"
  [ "$status" -eq 0 ]

  # Input = 1 (raw, <10000)
  [[ "$output" =~ \|[[:space:]]+1[[:space:]]+ ]]
  # cache_read = 55491 → 55.4k (bc truncates, not rounds)
  [[ "$output" == *"55.4k"* ]]
  # cache_creation = 807 (raw, <10000)
  [[ "$output" == *"807"* ]]
  # output = 608 (raw, <10000)
  [[ "$output" == *"608"* ]]
}

@test "render-subagents: token fields show dash when usage is null" {
  local ts hf
  ts="$(date -Iseconds)"
  hf="$(history_file_for)"

  # Write entry with null usage
  jq -cn \
    --arg tid "toolu_null_tok" --arg sid "SES_NULL_TOK" \
    --arg started "$ts" \
    '{session_id:$sid, tool_use_id:$tid, subagent_type:"sdd-spec",
      description:"Null usage test", prompt:"p",
      started:$started, ended:$started, duration_ms:5000,
      status:"done", total_cost_usd:null, usage:null, response:null}' >> "$hf"

  run env CLAUDE_SESSION_ID="SES_NULL_TOK" "$RENDERER"
  [ "$status" -eq 0 ]

  # All 4 token columns should show — (em-dash placeholder)
  local dash_count
  dash_count="$(printf '%s' "$output" | grep -oP '—' | wc -l || true)"
  [ "$dash_count" -ge 4 ]
}

@test "render-subagents: k-formatting kicks in at 10000 but not at 9999" {
  local ts
  ts="$(date -Iseconds)"
  # Seed: cache_read=10000 → should render as "10.0k", cache_creation=9999 → raw "9999"
  write_history_done_full_tokens \
    "toolu_kfmt" "SES_KFMT" "sdd-spec" "K format threshold test" \
    "$ts" "$ts" 5000 1 10000 9999 1

  run env CLAUDE_SESSION_ID="SES_KFMT" "$RENDERER"
  [ "$status" -eq 0 ]

  # 10000 → 10.0k
  [[ "$output" == *"10.0k"* ]]
  # 9999 → raw (no k suffix)
  [[ "$output" == *"9999"* ]]
  [[ "$output" != *"9.9k"* ]]
}
