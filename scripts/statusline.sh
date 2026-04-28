#!/usr/bin/env bash
# scripts/statusline.sh
# Statusline renderer — reads stdin JSON, emits a formatted statusline string.
# v0.3: adds ⏱ session elapsed (oldest started entry); removes ▶/⚠ in-flight segment.
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
elapsed_seg=""
state_file="${HOME}/.claude/state/delegations-${session_id}.jsonl"

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

  # Session elapsed: time since the oldest entry with a "started" field.
  oldest_started="$(jq -rs '
    [.[] | select(.started != null and .started != "") | .started] | sort | .[0] // empty
  ' "$state_file" 2>/dev/null)" || oldest_started=""

  if [[ -n "$oldest_started" ]]; then
    now_s="$(date +%s)"
    started_s="$(date -d "$oldest_started" +%s 2>/dev/null || printf '%s' "$now_s")"
    sess_elapsed=$(( now_s - started_s ))
    (( sess_elapsed < 0 )) && sess_elapsed=0

    # Format elapsed: Xs / Xm Ys / Xh Ym
    if   (( sess_elapsed < 60   )); then sess_elapsed_fmt="${sess_elapsed}s"
    elif (( sess_elapsed < 3600 )); then sess_elapsed_fmt="$((sess_elapsed/60))m $((sess_elapsed%60))s"
    else                                 sess_elapsed_fmt="$((sess_elapsed/3600))h $(((sess_elapsed%3600)/60))m"
    fi

    elapsed_seg=" │ ⏱ ${sess_elapsed_fmt}"
  fi
fi

# Failed segment (only when F ≥ 1).
failed_seg=""
(( failed_count > 0 )) && failed_seg=$(printf ' │ ✗ %d failed' "$failed_count")

# Render the final format.
# When elapsed_seg is empty and failed_seg is empty, output is byte-identical to v0.1 baseline.
printf '[%s] %s%s%s %d%% │ ⚡ %d running | ✓ %d done%s%s\n' \
  "$model" "$color" "$bar" "$reset" "$pct_int" \
  "$running" "$done_count" "$failed_seg" "$elapsed_seg"

exit 0
