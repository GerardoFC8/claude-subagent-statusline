#!/usr/bin/env bash
# scripts/statusline.sh
# Statusline renderer — reads stdin JSON, emits a formatted statusline string.
# v0.4: ✗ failed and ⏱ elapsed are always rendered; session-start timestamp
#       persisted to ~/.claude/state/session-start-<session_id> on first run.
# MUST exit 0 in ALL cases.

set -uo pipefail

payload="$(cat)"

# Dependency guard — jq is required for parsing; degrade gracefully if missing.
if ! command -v jq >/dev/null 2>&1; then
  printf '[?] (jq missing)\n'
  exit 0
fi

# Parse stdin fields with safe defaults.
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null || true)"
model="$(printf '%s' "$payload" | jq -r '.model.display_name // "?"' 2>/dev/null || true)"
pct_raw="$(printf '%s' "$payload" | jq -r '.context_window.used_percentage // 0' 2>/dev/null || true)"

# Apply defaults for fields that may be empty after jq (e.g., empty stdin).
[[ -z "$model"   ]] && model="?"
[[ -z "$pct_raw" ]] && pct_raw=0

# Coerce pct to integer; fall back to 0 on non-numeric input.
pct_int="$(printf '%.0f' "$pct_raw" 2>/dev/null)" || pct_int=0
# Clamp to [0, 100].
(( pct_int < 0 ))   && pct_int=0
(( pct_int > 100 )) && pct_int=100

# Pick ANSI bar color by threshold.
if   (( pct_int < 50 )); then color=$'\033[32m'
elif (( pct_int < 80 )); then color=$'\033[33m'
else                          color=$'\033[31m'
fi
reset=$'\033[0m'

# Build 10-cell bar: filled = floor(pct / 10) per spec (REQ-STATUSLINE-003).
filled=$(( pct_int / 10 ))
(( filled > 10 )) && filled=10
(( filled < 0 ))  && filled=0
empty=$(( 10 - filled ))

bar=""
for (( i = 0; i < filled; i++ )); do bar+="█"; done
for (( i = 0; i < empty;  i++ )); do bar+="░"; done

# Count delegations from the JSONL state file for this session.
running=0
done_count=0
failed_count=0
oldest_started=""
elapsed_seg=""
state_file="${HOME}/.claude/state/delegations-${session_id}.jsonl"

# Persist a session-start timestamp the first time we see this session_id.
# This is the elapsed baseline when no JSONL entries carry a "started" field.
session_start_file=""
if [[ -n "$session_id" ]]; then
  mkdir -p "${HOME}/.claude/state" 2>/dev/null || true
  session_start_file="${HOME}/.claude/state/session-start-${session_id}"
  if [[ ! -f "$session_start_file" ]]; then
    if printf '%s' "$(date +%s)" > "${session_start_file}.tmp" 2>/dev/null; then
      mv "${session_start_file}.tmp" "$session_start_file" 2>/dev/null || true
    fi
  fi
fi

if [[ -n "$session_id" && -r "$state_file" ]]; then
  # done set D = distinct ids where any line has status=="done"
  done_count="$(jq -rs '
    map(select(.status == "done") | .id) | unique | length
  ' "$state_file" 2>/dev/null)" || done_count=0

  # failed set F = distinct ids where any line has status=="failed"
  failed_count="$(jq -rs '
    map(select(.status == "failed") | .id) | unique | length
  ' "$state_file" 2>/dev/null)" || failed_count=0

  # running set R = distinct ids with status=="running" minus ids in D or F
  # AUDIT FIX: subtract both done AND failed from running to prevent double-count.
  running="$(jq -rs '
    (map(select(.status == "done")    | .id) | unique) as $d |
    (map(select(.status == "failed")  | .id) | unique) as $f |
    (map(select(.status == "running") | .id) | unique) as $r |
    ($r - $d - $f) | length
  ' "$state_file" 2>/dev/null)" || running=0

  # Session elapsed baseline: prefer oldest "started" field in JSONL entries.
  oldest_started="$(jq -rs '
    [.[] | select(.started != null and .started != "") | .started] | sort | .[0] // empty
  ' "$state_file" 2>/dev/null)" || oldest_started=""
fi

# Determine elapsed baseline epoch:
#  1. Oldest "started" from JSONL (parsed above) — preserves existing behavior.
#  2. Epoch from session-start-<session_id> file — used when JSONL has no started fields.
#  3. Nothing (no session_id) — skip segment.
elapsed_baseline_s=""
if [[ -n "${oldest_started:-}" ]]; then
  elapsed_baseline_s="$(date -d "$oldest_started" +%s 2>/dev/null)" || elapsed_baseline_s=""
fi
if [[ -z "$elapsed_baseline_s" && -n "$session_start_file" && -r "$session_start_file" ]]; then
  elapsed_baseline_s="$(cat "$session_start_file" 2>/dev/null)" || elapsed_baseline_s=""
fi

if [[ -n "$elapsed_baseline_s" ]]; then
  now_s="$(date +%s)"
  sess_elapsed=$(( now_s - elapsed_baseline_s ))
  (( sess_elapsed < 0 )) && sess_elapsed=0

  # Format elapsed: Xs / Xm Ys / Xh Ym
  if   (( sess_elapsed < 60   )); then sess_elapsed_fmt="${sess_elapsed}s"
  elif (( sess_elapsed < 3600 )); then sess_elapsed_fmt="$((sess_elapsed/60))m $((sess_elapsed%60))s"
  else                                 sess_elapsed_fmt="$((sess_elapsed/3600))h $(((sess_elapsed%3600)/60))m"
  fi

  elapsed_seg=" │ ⏱ ${sess_elapsed_fmt}"
fi

# Failed segment — always rendered (v0.4.0: always-on, default 0).
failed_seg="$(printf ' │ ✗ %d failed' "$failed_count")"

# Render the final format.
# v0.4.0: ✗ and ⏱ segments are always present when session_id is known.
printf '[%s] %s%s%s %d%% │ ⚡ %d running | ✓ %d done%s%s\n' \
  "$model" "$color" "$bar" "$reset" "$pct_int" \
  "$running" "$done_count" "$failed_seg" "$elapsed_seg"

exit 0
