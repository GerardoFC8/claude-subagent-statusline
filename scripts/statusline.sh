#!/usr/bin/env bash
# scripts/statusline.sh
# Statusline renderer — reads stdin JSON, emits a formatted statusline string.
# v0.2: adds in-flight winner (▶), stale prefix (⚠), and failed counter (✗).
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
inflight=""
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

  # In-flight winner: oldest still-running entry (not closed by done or failed).
  winner_json="$(jq -cs '
    (map(select(.status == "done")   | .id) | unique) as $d |
    (map(select(.status == "failed") | .id) | unique) as $f |
    [ .[] | select(.status == "running") | select( ([.id] | inside($d + $f)) | not ) ]
    | sort_by(.started)
    | .[0]
    // empty
  ' "$state_file" 2>/dev/null)" || winner_json=""

  if [[ -n "$winner_json" && "$winner_json" != "null" ]]; then
    w_type="$(printf '%s' "$winner_json" | jq -r '.type // ""')"
    w_desc="$(printf '%s' "$winner_json" | jq -r '.desc // ""')"
    w_started="$(printf '%s' "$winner_json" | jq -r '.started // empty')"

    if [[ -n "$w_started" ]]; then
      now_s="$(date +%s)"
      started_s="$(date -d "$w_started" +%s 2>/dev/null || printf '%s' "$now_s")"
      elapsed=$(( now_s - started_s ))
      (( elapsed < 0 )) && elapsed=0

      # Format elapsed: Xs / Xm Ys / Xh Ym
      if   (( elapsed < 60   )); then elapsed_fmt="${elapsed}s"
      elif (( elapsed < 3600 )); then elapsed_fmt="$((elapsed/60))m $((elapsed%60))s"
      else                            elapsed_fmt="$((elapsed/3600))h $(((elapsed%3600)/60))m"
      fi

      # Truncate desc to 30 chars with ellipsis (ASCII-safe).
      if (( ${#w_desc} > 30 )); then
        desc_trunc="${w_desc:0:29}…"
      else
        desc_trunc="$w_desc"
      fi

      # Stale prefix when elapsed > 1800s (30 minutes).
      stale_marker=""
      (( elapsed > 1800 )) && stale_marker="⚠ "

      inflight=$(printf '%s▶ %s: "%s" (%s) │ ' "$stale_marker" "$w_type" "$desc_trunc" "$elapsed_fmt")
    fi
  fi
fi

# Failed segment (only when F ≥ 1).
failed_seg=""
(( failed_count > 0 )) && failed_seg=$(printf ' │ ✗ %d failed' "$failed_count")

# Render the final format.
# When inflight is empty and failed_seg is empty, output is byte-identical to v0.1 baseline.
printf '[%s] %s%s%s %d%% │ %s⚡ %d running | ✓ %d done%s\n' \
  "$model" "$color" "$bar" "$reset" "$pct_int" \
  "$inflight" "$running" "$done_count" "$failed_seg"

exit 0
