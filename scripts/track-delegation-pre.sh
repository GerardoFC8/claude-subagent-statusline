#!/usr/bin/env bash
# scripts/track-delegation-pre.sh
# PreToolUse hook — appends a lean "running" entry to the per-session JSONL counter file
# AND a full-fat "running" seed entry to the global history file.
# Counter line shape: {"id","type","desc","started"(ISO8601+TZ),"status":"running"}
# History line shape: {"session_id","tool_use_id","subagent_type","description","prompt",
#                      "started","ended":null,"duration_ms":null,"status":"running",
#                      "total_cost_usd":null,"usage":null,"cwd"}
# MUST exit 0 in ALL cases (Claude Code blocks the host turn on non-zero hook exit).

set -uo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/history-lib.sh"

payload="$(cat)"

# Dependency guard — degrade silently if jq is missing.
command -v jq >/dev/null 2>&1 || exit 0

# Parse required and optional fields from stdin JSON.
session_id="$(printf '%s' "$payload"    | jq -r '.session_id // empty')"
tool_use_id="$(printf '%s' "$payload"   | jq -r '.tool_use_id // empty')"
subagent_type="$(printf '%s' "$payload" | jq -r '.tool_input.subagent_type // empty')"
description="$(printf '%s' "$payload"   | jq -r '.tool_input.description // empty')"
prompt="$(printf '%s' "$payload"        | jq -r '.tool_input.prompt // empty')"
cwd="$(printf '%s' "$payload"           | jq -r '.cwd // empty')"

# Required-fields guard — abandon quietly if either required field is missing.
[[ -z "$session_id" || -z "$tool_use_id" ]] && exit 0

state_dir="${HOME}/.claude/state"
mkdir -p "$state_dir" 2>/dev/null || exit 0
state_file="${state_dir}/delegations-${session_id}.jsonl"

# ISO8601 with second precision and timezone offset (e.g. 2026-04-28T10:18:23-03:00).
started="$(date -Iseconds)"

# --- Counter line (UNCHANGED lean shape; preserves PIPE_BUF atomicity for hot path) ---
counter_line="$(jq -cn \
  --arg id      "$tool_use_id" \
  --arg type    "$subagent_type" \
  --arg desc    "$description" \
  --arg started "$started" \
  '{id: $id, type: $type, desc: $desc, started: $started, status: "running"}')"

# Single printf append — atomic for lines < PIPE_BUF (4096 bytes).
printf '%s\n' "$counter_line" >> "$state_file" 2>/dev/null || true

# --- History entry (full-fat; safe encoding via jq --arg for arbitrary prompt content) ---
# CLAUDE_PLUGIN_DATA is auto-set by Claude Code per-plugin (confirmed via live gate).
history_entry="$(jq -cn \
  --arg session_id    "$session_id" \
  --arg tool_use_id   "$tool_use_id" \
  --arg subagent_type "$subagent_type" \
  --arg description   "$description" \
  --arg prompt        "$prompt" \
  --arg started       "$started" \
  --arg cwd           "$cwd" \
  '{
    session_id:     $session_id,
    tool_use_id:    $tool_use_id,
    subagent_type:  $subagent_type,
    description:    $description,
    prompt:         $prompt,
    started:        $started,
    ended:          null,
    duration_ms:    null,
    status:         "running",
    total_cost_usd: null,
    usage:          null,
    cwd:            $cwd
  }')"
history_append "$history_entry"

exit 0
