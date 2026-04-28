#!/usr/bin/env bash
# scripts/track-delegation-pre.sh
# PreToolUse hook — appends a spec-compliant "running" entry to the per-session JSONL state file.
# Line shape: {"id","type","desc","started"(ISO8601+TZ),"status":"running"}
# MUST exit 0 in ALL cases (Claude Code blocks the host turn on non-zero hook exit).

set -uo pipefail

payload="$(cat)"

# Dependency guard — degrade silently if jq is missing.
command -v jq >/dev/null 2>&1 || exit 0

# Parse required and optional fields from stdin JSON.
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty')"
tool_use_id="$(printf '%s' "$payload" | jq -r '.tool_use_id // empty')"
subagent_type="$(printf '%s' "$payload" | jq -r '.tool_input.subagent_type // empty')"
description="$(printf '%s' "$payload" | jq -r '.tool_input.description // empty')"

# Required-fields guard — abandon quietly if either required field is missing.
[[ -z "$session_id" || -z "$tool_use_id" ]] && exit 0

state_dir="${HOME}/.claude/state"
mkdir -p "$state_dir" 2>/dev/null || exit 0
state_file="${state_dir}/delegations-${session_id}.jsonl"

# ISO8601 with second precision and timezone offset (e.g. 2026-04-28T10:18:23-03:00).
started="$(date -Iseconds)"
line="$(jq -cn \
  --arg id      "$tool_use_id" \
  --arg type    "$subagent_type" \
  --arg desc    "$description" \
  --arg started "$started" \
  '{id: $id, type: $type, desc: $desc, started: $started, status: "running"}')"

# Single printf append — atomic for lines < PIPE_BUF (4096 bytes).
printf '%s\n' "$line" >> "$state_file" 2>/dev/null || true

exit 0
