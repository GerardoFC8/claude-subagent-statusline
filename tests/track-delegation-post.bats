#!/usr/bin/env bats
# tests/track-delegation-post.bats — REQ-TRACK-POST-001..004

load helpers

# ---------------------------------------------------------------------------
# Test 1: happy path — appends done entry when state file pre-exists (via pre-hook)
# ---------------------------------------------------------------------------
@test "post: happy path — appends done entry to state file" {
  # Pre-hook must have fired first (creates the state file) — that is the real lifecycle.
  local pre_payload='{"tool_use_id":"toolu_Z","session_id":"P1","tool_input":{"subagent_type":"sdd-spec"}}'
  run_pre "$pre_payload"

  local payload='{"tool_use_id":"toolu_Z","session_id":"P1","tool_response":{"status":"completed"}}'
  run run_post "$payload"
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for P1)"
  [ -f "$sf" ]

  # File now has 2 lines: one running (from pre), one done (from post)
  [ "$(wc -l < "$sf")" -eq 2 ]

  # The last line is the done entry
  local line
  line="$(tail -1 "$sf")"
  [ "$(printf '%s' "$line" | jq -r '.id')"     = "toolu_Z" ]
  [ "$(printf '%s' "$line" | jq -r '.status')" = "done"    ]

  local ts
  ts="$(printf '%s' "$line" | jq -r '.ts // .ended // empty')"
  [ -n "$ts" ]
}

# ---------------------------------------------------------------------------
# Test 2: empty stdin — exit 0, no file
# ---------------------------------------------------------------------------
@test "post: empty stdin — exits 0, no file created" {
  run run_post ""
  [ "$status" -eq 0 ]

  # No JSONL file should appear for any reasonable session
  [ -z "$(ls "$HOME/.claude/state/" 2>/dev/null)" ]
}

# ---------------------------------------------------------------------------
# Test 3: malformed JSON — exit 0, no file
# ---------------------------------------------------------------------------
@test "post: malformed JSON — exits 0, no file created" {
  run run_post "broken"
  [ "$status" -eq 0 ]
  [ -z "$(ls "$HOME/.claude/state/" 2>/dev/null)" ]
}

# ---------------------------------------------------------------------------
# Test 4: missing session_id — exit 0, no file
# ---------------------------------------------------------------------------
@test "post: missing session_id — exits 0, no file created" {
  run run_post '{"tool_use_id":"toolu_X"}'
  [ "$status" -eq 0 ]
  [ -z "$(ls "$HOME/.claude/state/" 2>/dev/null)" ]
}

# ---------------------------------------------------------------------------
# Test 5: missing tool_use_id — exit 0, no file
# ---------------------------------------------------------------------------
@test "post: missing tool_use_id — exits 0, no file created" {
  run run_post '{"session_id":"P_NOID"}'
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for P_NOID)"
  [ ! -f "$sf" ]
}

# ---------------------------------------------------------------------------
# Test 6: post after pre, same id — state file has 2 lines (running then done)
# ---------------------------------------------------------------------------
@test "post: post-after-pre same id — file has running line then done line" {
  local pre_payload='{"tool_use_id":"toolu_PP","session_id":"PP_SES","tool_input":{"subagent_type":"sdd-apply"}}'
  local post_payload='{"tool_use_id":"toolu_PP","session_id":"PP_SES","tool_response":{"status":"completed"}}'

  run run_pre "$pre_payload";  [ "$status" -eq 0 ]
  run run_post "$post_payload"; [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for PP_SES)"
  [ -f "$sf" ]
  [ "$(wc -l < "$sf")" -eq 2 ]

  local id1 status1 id2 status2
  id1="$(sed -n '1p' "$sf" | jq -r '.id')"
  status1="$(sed -n '1p' "$sf" | jq -r '.status')"
  id2="$(sed -n '2p' "$sf" | jq -r '.id')"
  status2="$(sed -n '2p' "$sf" | jq -r '.status')"

  [ "$id1"     = "toolu_PP" ]
  [ "$status1" = "running"  ]
  [ "$id2"     = "toolu_PP" ]
  [ "$status2" = "done"     ]
}

# ---------------------------------------------------------------------------
# Test 7: duplicate post — state file has 2 done lines for same id
#   (deduplication is the statusline renderer's responsibility)
# ---------------------------------------------------------------------------
@test "post: duplicate post same id — two done lines appended" {
  # Pre-hook creates the state file first.
  local pre_payload='{"tool_use_id":"toolu_DUP","session_id":"DUP_SES","tool_input":{"subagent_type":"sdd-apply"}}'
  run_pre "$pre_payload"

  local payload='{"tool_use_id":"toolu_DUP","session_id":"DUP_SES","tool_response":{"status":"completed"}}'

  run run_post "$payload"; [ "$status" -eq 0 ]
  run run_post "$payload"; [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for DUP_SES)"
  [ -f "$sf" ]
  # pre(1) + post(2) = 3 lines total
  [ "$(wc -l < "$sf")" -eq 3 ]

  local done_count
  done_count="$(jq -s '[.[] | select(.status=="done")] | length' "$sf")"
  [ "$done_count" -eq 2 ]
}
