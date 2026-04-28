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

  local ended
  ended="$(printf '%s' "$line" | jq -r '.ended')"
  [ -n "$ended" ]
  # ISO8601 with timezone offset: YYYY-MM-DDTHH:MM:SS+HH:MM or -HH:MM
  [[ "$ended" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$ ]]
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

# ---------------------------------------------------------------------------
# Phase 4 tests — history writes (REQ-HOOKS-007, REQ-HISTORY-003, REQ-HISTORY-007)
# ---------------------------------------------------------------------------

@test "post: also writes history finalize entry with metrics" {
  local pre_payload='{"tool_use_id":"toolu_PM","session_id":"SPM","tool_input":{"subagent_type":"sdd-spec","description":"spec","prompt":"p"},"cwd":"/z"}'
  run_pre "$pre_payload"

  # EMPIRICAL: verify in Batch 3 — duration_ms top-level path assumed per design B.2
  local post_payload
  post_payload='{"tool_use_id":"toolu_PM","session_id":"SPM","duration_ms":42,"tool_response":{"total_cost_usd":0.047,"usage":{"input_tokens":3200,"output_tokens":8400}}}'
  run run_post "$post_payload"
  [ "$status" -eq 0 ]

  local hf
  hf="$(history_file_for)"
  [ -f "$hf" ]

  # 2 lines: seed (running) + finalize (done)
  local hcount
  hcount="$(wc -l < "$hf")"
  [ "$hcount" -eq 2 ]

  local finalize
  finalize="$(tail -1 "$hf")"

  [ "$(printf '%s' "$finalize" | jq -r '.tool_use_id')"    = "toolu_PM" ]
  [ "$(printf '%s' "$finalize" | jq -r '.status')"         = "done"     ]
  [ "$(printf '%s' "$finalize" | jq -r '.duration_ms')"    = "42"       ]
  [ "$(printf '%s' "$finalize" | jq -r '.total_cost_usd')" = "0.047"    ]
  [ "$(printf '%s' "$finalize" | jq -r '.usage.input_tokens')"  = "3200" ]
  [ "$(printf '%s' "$finalize" | jq -r '.usage.output_tokens')" = "8400" ]

  # ended must be non-empty ISO8601
  local ended
  ended="$(printf '%s' "$finalize" | jq -r '.ended')"
  [ -n "$ended" ]
  [[ "$ended" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$ ]]
}

@test "post: missing metrics produces null fields in history entry" {
  local pre_payload='{"tool_use_id":"toolu_PN","session_id":"SPN","tool_input":{"subagent_type":"sdd-spec","description":"d","prompt":"p"},"cwd":"/"}'
  run_pre "$pre_payload"

  # Payload omits duration_ms, total_cost_usd, and usage
  local post_payload='{"tool_use_id":"toolu_PN","session_id":"SPN","tool_response":{"status":"completed"}}'
  run run_post "$post_payload"
  [ "$status" -eq 0 ]

  local hf
  hf="$(history_file_for)"
  [ -f "$hf" ]

  local finalize
  finalize="$(tail -1 "$hf")"

  [ "$(printf '%s' "$finalize" | jq -r '.status')"         = "done" ]
  [ "$(printf '%s' "$finalize" | jq -r '.duration_ms')"    = "null" ]
  [ "$(printf '%s' "$finalize" | jq -r '.total_cost_usd')" = "null" ]
  [ "$(printf '%s' "$finalize" | jq -r '.usage')"          = "null" ]
}

@test "post: counter file lean shape unchanged after history addition" {
  local pre_payload='{"tool_use_id":"toolu_CRP","session_id":"SCRP","tool_input":{"subagent_type":"sdd-spec","description":"Desc"},"cwd":"/y"}'
  run_pre "$pre_payload"

  local post_payload='{"tool_use_id":"toolu_CRP","session_id":"SCRP","tool_response":{"status":"completed"}}'
  run run_post "$post_payload"
  [ "$status" -eq 0 ]

  local sf
  sf="$(state_file_for SCRP)"
  [ -f "$sf" ]
  [ "$(wc -l < "$sf")" -eq 2 ]

  # Line 1: lean running shape
  local l1
  l1="$(sed -n '1p' "$sf")"
  [ "$(printf '%s' "$l1" | jq -r '.status')" = "running" ]
  [ "$(printf '%s' "$l1" | jq '.prompt')"    = "null"    ]

  # Line 2: lean done shape — {id, ended, status:"done"} only
  local l2
  l2="$(sed -n '2p' "$sf")"
  [ "$(printf '%s' "$l2" | jq -r '.id')"     = "toolu_CRP" ]
  [ "$(printf '%s' "$l2" | jq -r '.status')" = "done"      ]
  [ "$(printf '%s' "$l2" | jq '.prompt')"    = "null"      ]
  [ "$(printf '%s' "$l2" | jq '.duration_ms')" = "null"    ]
}

@test "post: history finalize is append-only (seed line preserved)" {
  local pre_payload='{"tool_use_id":"toolu_AO","session_id":"SAO","tool_input":{"subagent_type":"sdd-spec","description":"AO test","prompt":"the prompt"},"cwd":"/ao"}'
  run_pre "$pre_payload"

  local post_payload='{"tool_use_id":"toolu_AO","session_id":"SAO","tool_response":{"status":"completed"}}'
  run run_post "$post_payload"
  [ "$status" -eq 0 ]

  local hf
  hf="$(history_file_for)"
  [ -f "$hf" ]
  [ "$(wc -l < "$hf")" -eq 2 ]

  # Seed line (first) must still have status:"running" and prompt intact
  local seed
  seed="$(head -1 "$hf")"
  [ "$(printf '%s' "$seed" | jq -r '.status')" = "running"    ]
  [ "$(printf '%s' "$seed" | jq -r '.prompt')" = "the prompt" ]

  # Finalize line (second) has status:"done"
  local fin
  fin="$(tail -1 "$hf")"
  [ "$(printf '%s' "$fin" | jq -r '.status')" = "done" ]
}

# ---------------------------------------------------------------------------
# Post-gate delta: response capture (Change A + C)
# ---------------------------------------------------------------------------

@test "post: history entry includes response field from tool_response.content[0].text" {
  local pre_payload='{"tool_use_id":"toolu_R1","session_id":"SR1","tool_input":{"subagent_type":"sdd-spec","description":"resp test","prompt":"p"},"cwd":"/r"}'
  run_pre "$pre_payload"

  local post_payload
  post_payload='{"tool_use_id":"toolu_R1","session_id":"SR1","duration_ms":1704,"tool_response":{"status":"completed","content":[{"type":"text","text":"TRACE-OK"}],"usage":{"input_tokens":3,"output_tokens":7}}}'
  run run_post "$post_payload"
  [ "$status" -eq 0 ]

  local hf fin
  hf="$(history_file_for)"
  fin="$(tail -1 "$hf")"

  [ "$(printf '%s' "$fin" | jq -r '.response')" = "TRACE-OK" ]
}

@test "post: history entry response is null when content is missing" {
  local pre_payload='{"tool_use_id":"toolu_R2","session_id":"SR2","tool_input":{"subagent_type":"sdd-spec","description":"no resp","prompt":"p"},"cwd":"/r2"}'
  run_pre "$pre_payload"

  local post_payload='{"tool_use_id":"toolu_R2","session_id":"SR2","tool_response":{"status":"completed"}}'
  run run_post "$post_payload"
  [ "$status" -eq 0 ]

  local hf fin
  hf="$(history_file_for)"
  fin="$(tail -1 "$hf")"

  [ "$(printf '%s' "$fin" | jq -r '.response')" = "null" ]
}

@test "post: history entry response is truncated at 16384 bytes with marker" {
  local pre_payload='{"tool_use_id":"toolu_R3","session_id":"SR3","tool_input":{"subagent_type":"sdd-spec","description":"trunc test","prompt":"p"},"cwd":"/r3"}'
  run_pre "$pre_payload"

  # Build a string >16384 chars (16385 x's)
  local big_text
  big_text="$(python3 -c "print('x'*16385, end='')")"

  local post_payload
  post_payload="$(jq -cn \
    --arg tid "toolu_R3" --arg sid "SR3" --arg txt "$big_text" \
    '{"tool_use_id":$tid,"session_id":$sid,"tool_response":{"status":"completed","content":[{"type":"text","text":$txt}]}}')"
  run run_post "$post_payload"
  [ "$status" -eq 0 ]

  local hf fin response
  hf="$(history_file_for)"
  fin="$(tail -1 "$hf")"
  response="$(printf '%s' "$fin" | jq -r '.response')"

  # Must end with truncation marker
  [[ "$response" == *" …(truncated)" ]]
  # The text portion before the marker must be exactly 16384 bytes
  local text_part
  text_part="${response% …(truncated)}"
  [ "${#text_part}" -eq 16384 ]
}
