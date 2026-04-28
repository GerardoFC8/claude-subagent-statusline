#!/usr/bin/env bash
# scripts/track-delegation-fail.sh
# PostToolUseFailure hook — appends a "failed" entry to BOTH the per-session counter file
# (if it exists) AND the global history file.
# Counter line shape: {"id","ended"(ISO8601+TZ),"status":"failed"}
# History line shape: {"session_id","tool_use_id","ended","duration_ms":null,
#                      "status":"failed","total_cost_usd":null,"usage":null}
# Design decision (AD-2.4): counter file gains status:"failed" so statusline reads one source.
# PostToolUseFailure payload shape assumed mirrors PostToolUse {session_id, tool_use_id}.
# Live trigger could not be reproduced (validation errors caught before hooks fire); script
# exits 0 silently if shape differs, so worst case is missing failure entries — never breakage.
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

ended="$(date -Iseconds)"

# --- Counter line: only written if the counter file already exists.
# (Consistent with post.sh: if pre never fired, no counter file to update.)
if [[ -r "$state_file" ]]; then
  counter_line="$(jq -cn \
    --arg id    "$tool_use_id" \
    --arg ended "$ended" \
    '{id: $id, ended: $ended, status: "failed"}')"
  printf '%s\n' "$counter_line" >> "$state_file" 2>/dev/null || true
fi

# --- History entry: always written (failure recorded globally even if pre never fired).
history_entry="$(jq -cn \
  --arg session_id  "$session_id" \
  --arg tool_use_id "$tool_use_id" \
  --arg ended       "$ended" \
  '{
    session_id:     $session_id,
    tool_use_id:    $tool_use_id,
    ended:          $ended,
    duration_ms:    null,
    status:         "failed",
    total_cost_usd: null,
    usage:          null
  }')"
history_append "$history_entry"

exit 0
