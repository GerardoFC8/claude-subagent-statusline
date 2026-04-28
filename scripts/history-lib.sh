#!/usr/bin/env bash
# shellcheck shell=bash
# scripts/history-lib.sh — sourced by pre/post/fail hooks. Never executed directly.
# Provides: history_path, history_append, history_trim_if_needed.
# All functions degrade silently and never return non-zero in a way that propagates.

# Resolve history file path:
#   1. ${CLAUDE_PLUGIN_DATA}/history.jsonl  if env set and non-empty
#   2. ${HOME}/.claude/state/delegation-history.jsonl  fallback
history_path() {
  local base
  if [[ -n "${CLAUDE_PLUGIN_DATA:-}" ]]; then
    base="${CLAUDE_PLUGIN_DATA}"
    printf '%s/history.jsonl\n' "$base"
  else
    base="${HOME}/.claude/state"
    printf '%s/delegation-history.jsonl\n' "$base"
  fi
}

# history_append <one-line-json>
# Best-effort. Creates parent dir. Append-only. Never propagates failure.
history_append() {
  local entry="$1"
  local file dir
  file="$(history_path)"
  dir="$(dirname "$file")"
  mkdir -p "$dir" 2>/dev/null || return 0
  printf '%s\n' "$entry" >> "$file" 2>/dev/null || true
  history_trim_if_needed "$file"
  return 0
}

# Ring buffer: trim only when file exceeds threshold lines, keep last KEEP.
# Atomic via tmp + mv (same FS).
HISTORY_TRIM_THRESHOLD="${HISTORY_TRIM_THRESHOLD:-600}"
HISTORY_KEEP="${HISTORY_KEEP:-500}"
history_trim_if_needed() {
  local file="$1"
  [[ -r "$file" ]] || return 0
  local lines
  lines="$(wc -l < "$file" 2>/dev/null || echo 0)"
  (( lines > HISTORY_TRIM_THRESHOLD )) || return 0
  local tmp="${file}.tmp.$$"
  if tail -n "$HISTORY_KEEP" "$file" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$file" 2>/dev/null || rm -f "$tmp" 2>/dev/null
  else
    rm -f "$tmp" 2>/dev/null
  fi
  return 0
}
