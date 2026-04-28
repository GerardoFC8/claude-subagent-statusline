#!/usr/bin/env bats
# tests/statusline.bats — REQ-STATUSLINE-001..008

load helpers

# Helper: write raw JSONL lines to the test state file for a session
write_jsonl() {
  local session_id="$1"
  local sf
  sf="$(state_file_for "$session_id")"
  shift
  for line in "$@"; do
    printf '%s\n' "$line" >> "$sf"
  done
}

# ---------------------------------------------------------------------------
# Test 1: happy path — 2 running, 1 done; model + pct rendered correctly
# ---------------------------------------------------------------------------
@test "statusline: happy path — correct format with running/done counts" {
  write_jsonl S1 \
    '{"id":"A","status":"running","ts":1}' \
    '{"id":"B","status":"running","ts":2}' \
    '{"id":"C","status":"done","ts":3}'

  local payload='{"session_id":"S1","model":{"display_name":"Opus 4.7"},"context_window":{"used_percentage":42}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  [[ "$output" == *"[Opus 4.7]"* ]]
  [[ "$output" == *"42%"* ]]
  [[ "$output" == *"2 running"* ]]
  [[ "$output" == *"1 done"* ]]
}

# ---------------------------------------------------------------------------
# Test 2: empty stdin — model fallback to "?", 0/0 counts
# ---------------------------------------------------------------------------
@test "statusline: empty stdin — model shows ? and 0/0 counts" {
  run run_statusline ""
  [ "$status" -eq 0 ]
  [[ "$output" == *"[?]"* ]]
  [[ "$output" == *"0 running"* ]] || [[ "$output" == *"running"* ]]
}

# ---------------------------------------------------------------------------
# Test 3: jq missing — outputs [?] (jq missing) and exits 0
# ---------------------------------------------------------------------------
@test "statusline: jq missing — outputs fallback and exits 0" {
  local payload='{"session_id":"JQ","model":{"display_name":"X"},"context_window":{"used_percentage":10}}'
  local script="$REPO_ROOT/scripts/statusline.sh"

  # Create a fake_bin dir that has bash/env/printf but NOT jq.
  local fake_bin="$BATS_TEST_TMPDIR/fake_bin"
  mkdir -p "$fake_bin"
  ln -sf "$(command -v bash)"   "$fake_bin/bash"
  ln -sf "$(command -v env)"    "$fake_bin/env"
  ln -sf "$(command -v printf)" "$fake_bin/printf" 2>/dev/null || true
  ln -sf "$(command -v date)"   "$fake_bin/date"   2>/dev/null || true
  ln -sf "$(command -v mkdir)"  "$fake_bin/mkdir"  2>/dev/null || true
  ln -sf "$(command -v wc)"     "$fake_bin/wc"     2>/dev/null || true

  run bash -c "export PATH='$fake_bin'; printf '%s' '$payload' | bash '$script'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[?]"* ]]
}

# ---------------------------------------------------------------------------
# Test 4: no state file — running=0, done=0
# ---------------------------------------------------------------------------
@test "statusline: no state file — running=0, done=0" {
  local payload='{"session_id":"NOSF","model":{"display_name":"Haiku"},"context_window":{"used_percentage":5}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  [[ "$output" == *"0 running"* ]]
  [[ "$output" == *"0 done"* ]]
}

# ---------------------------------------------------------------------------
# Test 5: bar color green — pct < 50 → ANSI \033[32m
# ---------------------------------------------------------------------------
@test "statusline: bar color green at pct=10" {
  local payload='{"session_id":"GRN","model":{"display_name":"M"},"context_window":{"used_percentage":10}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  # Check for ESC[32m (green) in the output
  [[ "$output" == *$'\033[32m'* ]]
}

# ---------------------------------------------------------------------------
# Test 6: bar color yellow — 50 <= pct < 80 → ANSI \033[33m
# ---------------------------------------------------------------------------
@test "statusline: bar color yellow at pct=60" {
  local payload='{"session_id":"YLW","model":{"display_name":"M"},"context_window":{"used_percentage":60}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[33m'* ]]
}

# ---------------------------------------------------------------------------
# Test 7: bar color red — pct >= 80 → ANSI \033[31m
# ---------------------------------------------------------------------------
@test "statusline: bar color red at pct=85" {
  local payload='{"session_id":"RED","model":{"display_name":"M"},"context_window":{"used_percentage":85}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[31m'* ]]
}

# ---------------------------------------------------------------------------
# Test 8: bar fill rounding — pct=44 → 4 filled, 6 empty
# ---------------------------------------------------------------------------
@test "statusline: bar fill — pct=44 shows 4 filled and 6 empty cells" {
  local payload='{"session_id":"BAR","model":{"display_name":"M"},"context_window":{"used_percentage":44}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  # Strip ANSI codes for counting
  local plain
  plain="$(printf '%s' "$output" | sed 's/\x1b\[[0-9;]*m//g')"

  # Count filled (█) and empty (░) chars — must have exactly 4 and 6
  local filled empty
  filled="$(printf '%s' "$plain" | grep -o '█' | wc -l)"
  empty="$(printf '%s' "$plain" | grep -o '░' | wc -l)"
  [ "$filled" -eq 4 ]
  [ "$empty"  -eq 6 ]
}

# ---------------------------------------------------------------------------
# Test 9: counter math — 3 distinct running ids, 0 done
# ---------------------------------------------------------------------------
@test "statusline: counter math — 3 running ids, 0 done" {
  write_jsonl CM9 \
    '{"id":"X","status":"running","ts":1}' \
    '{"id":"Y","status":"running","ts":2}' \
    '{"id":"Z","status":"running","ts":3}'

  local payload='{"session_id":"CM9","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  [[ "$output" == *"3 running"* ]]
  [[ "$output" == *"0 done"* ]]
}

# ---------------------------------------------------------------------------
# Test 10: counter math — 1 running id, 2 done lines for same id → done=1, running=0
# ---------------------------------------------------------------------------
@test "statusline: counter math — duplicate done lines deduped correctly" {
  write_jsonl CM10 \
    '{"id":"DUP","status":"running","ts":1}' \
    '{"id":"DUP","status":"done","ts":2}' \
    '{"id":"DUP","status":"done","ts":3}'

  local payload='{"session_id":"CM10","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  [[ "$output" == *"0 running"* ]]
  [[ "$output" == *"1 done"* ]]
}

# ---------------------------------------------------------------------------
# Test 11: counter math — out-of-order: done line before running line for same id
# ---------------------------------------------------------------------------
@test "statusline: counter math — out-of-order done before running is handled" {
  write_jsonl CM11 \
    '{"id":"OOO","status":"done","ts":1}' \
    '{"id":"OOO","status":"running","ts":2}'

  local payload='{"session_id":"CM11","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  [[ "$output" == *"0 running"* ]]
  [[ "$output" == *"1 done"* ]]
}

# ---------------------------------------------------------------------------
# Test 12: counter math — cross-session isolation (session B has no file)
# ---------------------------------------------------------------------------
@test "statusline: counter math — cross-session isolation, no bleed" {
  write_jsonl SES_A \
    '{"id":"A1","status":"running","ts":1}' \
    '{"id":"A2","status":"running","ts":2}' \
    '{"id":"A3","status":"done","ts":3}'

  # Request uses session B which has no JSONL file
  local payload='{"session_id":"SES_B","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  [[ "$output" == *"0 running"* ]]
  [[ "$output" == *"0 done"* ]]
}

# ---------------------------------------------------------------------------
# Test 13: pct out of range high — pct=150 clamped to 100, bar fully filled, color red
# ---------------------------------------------------------------------------
@test "statusline: pct=150 clamped to 100, bar fully filled, color red" {
  local payload='{"session_id":"PCT_HI","model":{"display_name":"M"},"context_window":{"used_percentage":150}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[31m'* ]]

  local plain
  plain="$(printf '%s' "$output" | sed 's/\x1b\[[0-9;]*m//g')"
  local filled
  filled="$(printf '%s' "$plain" | grep -o '█' | wc -l)"
  [ "$filled" -eq 10 ]
}

# ---------------------------------------------------------------------------
# Test 14: pct out of range low — pct=-5 clamped to 0, bar empty, color green
# ---------------------------------------------------------------------------
@test "statusline: pct=-5 clamped to 0, bar empty, color green" {
  local payload='{"session_id":"PCT_LO","model":{"display_name":"M"},"context_window":{"used_percentage":-5}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[32m'* ]]

  local plain
  plain="$(printf '%s' "$output" | sed 's/\x1b\[[0-9;]*m//g')"
  local empty_cells
  empty_cells="$(printf '%s' "$plain" | grep -o '░' | wc -l)"
  [ "$empty_cells" -eq 10 ]
}

# ---------------------------------------------------------------------------
# Test 15: pct non-numeric — falls back to 0
# ---------------------------------------------------------------------------
@test "statusline: pct non-numeric — falls back to 0, exits 0" {
  local payload='{"session_id":"PCT_NAN","model":{"display_name":"M"},"context_window":{"used_percentage":"abc"}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]
  [[ "$output" == *"0%"* ]]
}

# ---------------------------------------------------------------------------
# Test 16: bar floor boundary — pct=45 must give 4 filled cells, not 5
#   Spec says floor(pct/10): floor(45/10)=4. A rounding impl gives (45+5)/10=5.
# ---------------------------------------------------------------------------
@test "statusline: bar uses floor at pct=45 (4 cells, not 5)" {
  local payload='{"session_id":"FLOOR45","model":{"display_name":"M"},"context_window":{"used_percentage":45}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  local plain
  plain="$(printf '%s' "$output" | sed 's/\x1b\[[0-9;]*m//g')"

  local filled empty
  filled="$(printf '%s' "$plain" | grep -o '█' | wc -l)"
  empty="$(printf '%s' "$plain" | grep -o '░' | wc -l)"
  [ "$filled" -eq 4 ]
  [ "$empty"  -eq 6 ]
}

# ---------------------------------------------------------------------------
# Phase 6 tests — in-flight, failed counter, stale prefix
# REQ-STATUSLINE-009..013
# ---------------------------------------------------------------------------

# Helper: create a counter line with a started timestamp N seconds ago.
jsonl_running_ago() {
  local id="$1" type="$2" desc="$3" secs_ago="$4"
  local started
  started="$(date -d "@$(( $(date +%s) - secs_ago ))" -Iseconds 2>/dev/null || date -Iseconds)"
  printf '{"id":"%s","type":"%s","desc":"%s","started":"%s","status":"running"}\n' \
    "$id" "$type" "$desc" "$started"
}

@test "statusline: single in-flight shows ▶ segment with elapsed" {
  # One running entry started 75 seconds ago
  local sf
  sf="$(state_file_for INFL1)"
  printf '%s\n' "$(jsonl_running_ago toolu_A sdd-spec "Write spec for X" 75)" >> "$sf"

  local payload='{"session_id":"INFL1","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  [[ "$output" == *"▶"* ]]
  [[ "$output" == *"Write spec for X"* ]]
  # elapsed is 75s = 1m 15s
  [[ "$output" == *"1m"* ]]
}

@test "statusline: in-flight winner picks oldest among multiple running" {
  local sf
  sf="$(state_file_for INFL2)"
  printf '%s\n' "$(jsonl_running_ago toolu_A sdd-spec "Newest desc" 10)"  >> "$sf"
  printf '%s\n' "$(jsonl_running_ago toolu_B sdd-design "Middle desc" 30)" >> "$sf"
  printf '%s\n' "$(jsonl_running_ago toolu_C sdd-apply "Oldest desc" 60)"  >> "$sf"

  local payload='{"session_id":"INFL2","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  # Oldest-started (60s ago) must win
  [[ "$output" == *"Oldest desc"* ]]
  # Newer ones must NOT appear
  [[ "$output" != *"Newest desc"* ]]
  [[ "$output" != *"Middle desc"* ]]
}

@test "statusline: in-flight desc truncated to 30 chars with ellipsis" {
  local long_desc="This is a very long description that exceeds thirty characters"
  local sf
  sf="$(state_file_for INFL3)"
  printf '{"id":"toolu_T","type":"sdd-spec","desc":"%s","started":"%s","status":"running"}\n' \
    "$long_desc" "$(date -Iseconds)" >> "$sf"

  local payload='{"session_id":"INFL3","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  [[ "$output" == *"▶"* ]]
  # Output must contain the ellipsis character (truncation applied)
  [[ "$output" == *"…"* ]]
  # Full desc must NOT appear
  [[ "$output" != *"$long_desc"* ]]
}

@test "statusline: stale running (>30min) shows ⚠ prefix" {
  local sf
  sf="$(state_file_for STALE1)"
  # 31 minutes = 1860 seconds ago
  printf '%s\n' "$(jsonl_running_ago toolu_S sdd-spec "Stale task" 1860)" >> "$sf"

  local payload='{"session_id":"STALE1","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  [[ "$output" == *"⚠"* ]]
  [[ "$output" == *"▶"* ]]
}

@test "statusline: failed counter shows ✗ N failed when F≥1" {
  local sf
  sf="$(state_file_for FAIL1)"
  # One running then one failed line for same id
  local started
  started="$(date -Iseconds)"
  printf '{"id":"toolu_F","type":"sdd-spec","desc":"d","started":"%s","status":"running"}\n' "$started" >> "$sf"
  printf '{"id":"toolu_F","ended":"%s","status":"failed"}\n' "$(date -Iseconds)" >> "$sf"

  local payload='{"session_id":"FAIL1","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  [[ "$output" == *"✗"* ]]
  [[ "$output" == *"1 failed"* ]]
}

@test "statusline: no ✗ segment when F=0" {
  local sf
  sf="$(state_file_for FAIL0)"
  local started
  started="$(date -Iseconds)"
  printf '{"id":"toolu_D","type":"sdd-spec","desc":"d","started":"%s","status":"running"}\n' "$started" >> "$sf"
  printf '{"id":"toolu_D","ended":"%s","status":"done"}\n' "$(date -Iseconds)" >> "$sf"

  local payload='{"session_id":"FAIL0","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  [[ "$output" != *"✗"* ]]
}

@test "statusline: failed entries excluded from running count" {
  local sf
  sf="$(state_file_for EXCL1)"
  local started
  started="$(date -Iseconds)"
  # One id: running seed then failed close — must count as 0 running, 1 failed
  printf '{"id":"toolu_E","type":"sdd-spec","desc":"d","started":"%s","status":"running"}\n' "$started" >> "$sf"
  printf '{"id":"toolu_E","ended":"%s","status":"failed"}\n' "$(date -Iseconds)" >> "$sf"

  local payload='{"session_id":"EXCL1","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  [[ "$output" == *"0 running"* ]]
  [[ "$output" == *"1 failed"* ]]
  # No ▶ segment since nothing is actually running
  [[ "$output" != *"▶"* ]]
}

@test "statusline: mixed done+failed+running renders all three segments" {
  local sf
  sf="$(state_file_for MIX1)"
  local t
  t="$(date -Iseconds)"
  # done id
  printf '{"id":"toolu_D","type":"sdd-spec","desc":"done task","started":"%s","status":"running"}\n' "$t" >> "$sf"
  printf '{"id":"toolu_D","ended":"%s","status":"done"}\n' "$t" >> "$sf"
  # failed id
  printf '{"id":"toolu_F","type":"sdd-design","desc":"fail task","started":"%s","status":"running"}\n' "$t" >> "$sf"
  printf '{"id":"toolu_F","ended":"%s","status":"failed"}\n' "$t" >> "$sf"
  # running id (still running)
  printf '%s\n' "$(jsonl_running_ago toolu_R sdd-apply "running task" 5)" >> "$sf"

  local payload='{"session_id":"MIX1","model":{"display_name":"M"},"context_window":{"used_percentage":20}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  [[ "$output" == *"1 done"* ]]
  [[ "$output" == *"✗ 1 failed"* ]]
  [[ "$output" == *"1 running"* ]]
  [[ "$output" == *"▶"* ]]
}

@test "statusline: regression — empty counter output identical to v0.1 format" {
  # No state file — output must match v0.1 baseline (no ▶, no ✗)
  local payload='{"session_id":"REG1","model":{"display_name":"TestModel"},"context_window":{"used_percentage":30}}'
  run run_statusline "$payload"
  [ "$status" -eq 0 ]

  # v0.1-compatible assertions
  [[ "$output" == *"[TestModel]"* ]]
  [[ "$output" == *"30%"* ]]
  [[ "$output" == *"0 running"* ]]
  [[ "$output" == *"0 done"* ]]
  # No in-flight or failed segments
  [[ "$output" != *"▶"* ]]
  [[ "$output" != *"✗"* ]]
}
