#!/usr/bin/env bash
# scripts/track-delegation-post.sh
# PostToolUse hook — appends a lean "done" entry to the per-session JSONL counter file
# AND a finalization entry (with metrics) to the global history file.
# Counter line shape: {"id","ended"(ISO8601+TZ),"status":"done"}
# History line shape: {"session_id","tool_use_id","ended","duration_ms","status":"done",
#                      "total_cost_usd","usage","response"}
# response: tool_response.content[0].text, truncated at 16384 bytes; null if absent.
# MUST exit 0 in ALL cases (Claude Code blocks the host turn on non-zero hook exit).

set -uo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/history-lib.sh"

payload="$(cat)"

# Dependency guard — degrade silently if jq is missing.
command -v jq >/dev/null 2>&1 || exit 0

# Parse required fields from stdin JSON.
session_id="$(printf '%s' "$payload"  | jq -r '.session_id // empty')"
tool_use_id="$(printf '%s' "$payload" | jq -r '.tool_use_id // empty')"

# Required-fields guard — abandon quietly if either required field is missing.
[[ -z "$session_id" || -z "$tool_use_id" ]] && exit 0

state_dir="${HOME}/.claude/state"
state_file="${state_dir}/delegations-${session_id}.jsonl"

# Missing-file tolerance (REQ-TRACK-POST-003) — do not create the file if it
# does not exist (means the pre-hook never fired for this session).
[[ -r "$state_file" ]] || exit 0

# Metrics from PostToolUse payload.
# EMPIRICAL: duration_ms is at top-level (confirmed via live gate).
duration_ms="$(printf '%s' "$payload"    | jq -r '.duration_ms // empty')"
total_cost_usd="$(printf '%s' "$payload" | jq -r '.tool_response.total_cost_usd // empty')"
input_tokens="$(printf '%s' "$payload"   | jq -r '.tool_response.usage.input_tokens // empty')"
output_tokens="$(printf '%s' "$payload"  | jq -r '.tool_response.usage.output_tokens // empty')"

# Response text: tool_response.content[0].text (EMPIRICAL: confirmed present in live gate).
# Truncate at 16384 bytes to bound history file growth.
response_raw="$(printf '%s' "$payload" | jq -r '.tool_response.content[0].text // empty')"
if [[ -n "$response_raw" ]]; then
  response_text="${response_raw:0:16384}"
  if [[ "${#response_raw}" -gt 16384 ]]; then
    response_text="${response_text} …(truncated)"
  fi
else
  response_text=""
fi

# ISO8601 with second precision and timezone offset.
ended="$(date -Iseconds)"

# --- Counter line (UNCHANGED lean shape) ---
counter_line="$(jq -cn \
  --arg id    "$tool_use_id" \
  --arg ended "$ended" \
  '{id: $id, ended: $ended, status: "done"}')"

# Single printf append — atomic for lines < PIPE_BUF (4096 bytes).
printf '%s\n' "$counter_line" >> "$state_file" 2>/dev/null || true

# --- History finalization entry. Numeric fields use --argjson with explicit null fallback. ---
# to_json_num: echoes literal JSON number or the literal string "null".
to_json_num() {
  [[ -n "$1" ]] && printf '%s' "$1" || printf 'null'
}
dms_j="$(to_json_num "$duration_ms")"
cost_j="$(to_json_num "$total_cost_usd")"
in_j="$(to_json_num "$input_tokens")"
out_j="$(to_json_num "$output_tokens")"

history_entry="$(jq -cn \
  --arg session_id   "$session_id" \
  --arg tool_use_id  "$tool_use_id" \
  --arg ended        "$ended" \
  --arg response_str "$response_text" \
  --argjson duration_ms    "$dms_j" \
  --argjson total_cost_usd "$cost_j" \
  --argjson input_tokens   "$in_j" \
  --argjson output_tokens  "$out_j" \
  '{
    session_id:     $session_id,
    tool_use_id:    $tool_use_id,
    ended:          $ended,
    duration_ms:    $duration_ms,
    status:         "done",
    total_cost_usd: $total_cost_usd,
    usage: (if $input_tokens == null and $output_tokens == null
            then null
            else {input_tokens: $input_tokens, output_tokens: $output_tokens}
            end),
    response: (if $response_str == "" then null else $response_str end)
  }')"
history_append "$history_entry"

exit 0
