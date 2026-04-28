#!/usr/bin/env bash
# scripts/track-delegation-post.sh
# PostToolUse hook — appends a "done" entry to the per-session JSONL state file.
# MUST exit 0 in ALL cases (Claude Code blocks the host turn on non-zero hook exit).

set -uo pipefail

payload="$(cat)"

# Dependency guard — degrade silently if jq is missing.
command -v jq >/dev/null 2>&1 || exit 0

# Parse required fields from stdin JSON.
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty')"
tool_use_id="$(printf '%s' "$payload" | jq -r '.tool_use_id // empty')"

# Required-fields guard — abandon quietly if either required field is missing.
[[ -z "$session_id" || -z "$tool_use_id" ]] && exit 0

state_dir="${HOME}/.claude/state"
state_file="${state_dir}/delegations-${session_id}.jsonl"

# Missing-file tolerance (REQ-TRACK-POST-003) — do not create the file if it
# does not exist (means the pre-hook never fired for this session).
[[ -r "$state_file" ]] || exit 0

ts="$(date +%s)"
line="$(jq -cn \
  --arg id     "$tool_use_id" \
  --argjson ts "$ts" \
  '{id: $id, status: "done", ts: $ts}')"

# Single printf append — atomic for lines < PIPE_BUF (4096 bytes).
printf '%s\n' "$line" >> "$state_file" 2>/dev/null || true

exit 0
