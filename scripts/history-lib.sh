#!/usr/bin/env bash
# shellcheck shell=bash
# scripts/history-lib.sh — sourced by pre/post/fail hooks. Never executed directly.
# Provides: history_path, history_append, history_trim_if_needed.
# All functions degrade silently and never return non-zero in a way that propagates.

# Resolve history file path — three-tier priority:
#   1. ${CLAUDE_PLUGIN_DATA}/history.jsonl          if env set (hook subprocesses)
#   2. ${HOME}/.claude/plugins/data/claude-subagent-statusline-claude-subagent-statusline/history.jsonl
#                                                   per-plugin data convention (slash commands, external)
#   3. ${HOME}/.claude/state/delegation-history.jsonl   legacy fallback
#
# For WRITEs (hooks): mkdir -p is handled by history_append before the write.
# For path 2: Claude Code creates the dir at install time, but mkdir -p is defensive and harmless.
HISTORY_CONVENTION_DIR="${HOME}/.claude/plugins/data/claude-subagent-statusline-claude-subagent-statusline"

history_path() {
  if [[ -n "${CLAUDE_PLUGIN_DATA:-}" ]]; then
    printf '%s/history.jsonl\n' "${CLAUDE_PLUGIN_DATA}"
    return
  fi
  if [[ -d "${HISTORY_CONVENTION_DIR}" ]]; then
    printf '%s/history.jsonl\n' "${HISTORY_CONVENTION_DIR}"
    return
  fi
  printf '%s/.claude/state/delegation-history.jsonl\n' "${HOME}"
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
