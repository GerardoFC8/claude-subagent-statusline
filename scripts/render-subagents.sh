#!/usr/bin/env bash
# scripts/render-subagents.sh
# Token-free renderer for /subagents slash command.
# Usage:
#   render-subagents.sh              → table of last 20 delegations
#   render-subagents.sh <N>          → table of last N delegations (cap 100)
#   render-subagents.sh stats [SID]  → per-session stats block
# ANSI colors: green=done, red=failed, yellow=running.
# Exits 0 in all cases.

set -uo pipefail

# ---------------------------------------------------------------------------
# Resolve history file path — three-tier priority (mirrors history-lib.sh).
#   1. ${CLAUDE_PLUGIN_DATA}/history.jsonl          if env set (hook subprocesses)
#   2. ~/.claude/plugins/data/<plugin-id>/history.jsonl  per-plugin convention
#   3. ~/.claude/state/delegation-history.jsonl         legacy fallback
# For READs: use the first path that exists and is non-empty.
# ---------------------------------------------------------------------------
_HISTORY_CONVENTION="${HOME}/.claude/plugins/data/claude-subagent-statusline-claude-subagent-statusline/history.jsonl"
_HISTORY_LEGACY="${HOME}/.claude/state/delegation-history.jsonl"

if [[ -n "${CLAUDE_PLUGIN_DATA:-}" ]]; then
  HISTORY_FILE="${CLAUDE_PLUGIN_DATA}/history.jsonl"
elif [[ -s "${_HISTORY_CONVENTION}" ]]; then
  HISTORY_FILE="${_HISTORY_CONVENTION}"
elif [[ -s "${_HISTORY_LEGACY}" ]]; then
  HISTORY_FILE="${_HISTORY_LEGACY}"
else
  # No path has data — pick convention dir if it exists, else legacy.
  # The empty-state check below will handle the "no file / empty file" case.
  if [[ -d "${HOME}/.claude/plugins/data/claude-subagent-statusline-claude-subagent-statusline" ]]; then
    HISTORY_FILE="${_HISTORY_CONVENTION}"
  else
    HISTORY_FILE="${_HISTORY_LEGACY}"
  fi
fi

# ANSI escape codes
GREEN=$'\033[32m'
RED=$'\033[31m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

# ---------------------------------------------------------------------------
# Empty-state check
# ---------------------------------------------------------------------------
if [[ ! -f "$HISTORY_FILE" || ! -s "$HISTORY_FILE" ]]; then
  printf 'No delegations recorded yet.\n'
  exit 0
fi

# ---------------------------------------------------------------------------
# Parse argument: default=table/20, stats, or N
# ---------------------------------------------------------------------------
mode="table"
table_n=20
session_filter=""

arg1="${1:-}"
arg2="${2:-}"

if [[ "$arg1" == "stats" ]]; then
  mode="stats"
  session_filter="$arg2"
elif [[ "$arg1" =~ ^[0-9]+$ ]]; then
  mode="table"
  table_n="$arg1"
  (( table_n > 100 )) && table_n=100
  (( table_n < 1  )) && table_n=1
fi

# ---------------------------------------------------------------------------
# Fold JSONL: group by tool_use_id, merge running+done+failed into one record.
# Uses first(...) // null pattern to avoid collapsing groups that lack a status.
# ---------------------------------------------------------------------------
# shellcheck disable=SC2016
FOLD_JQ='
  group_by(.tool_use_id)
  | map(
      (first(.[] | select(.status == "running")) // null) as $seed
      | (first(.[] | select(.status == "failed")) // null) as $fail
      | (first(.[] | select(.status == "done"))   // null) as $ok
      | ($fail // $ok // $seed) as $final
      | ($seed // $final // {}) as $meta
      | {
          session_id:     ($meta.session_id     // null),
          tool_use_id:    ($meta.tool_use_id    // null),
          subagent_type:  ($meta.subagent_type  // null),
          description:    ($meta.description    // null),
          prompt:         ($meta.prompt         // null),
          started:        ($meta.started        // null),
          ended:          (($final // {}).ended         // null),
          duration_ms:    (($final // {}).duration_ms   // null),
          status:         (($final // {}).status        // "running"),
          total_cost_usd: (($final // {}).total_cost_usd // null),
          usage:          (($final // {}).usage          // null),
          response:       (($final // {}).response       // null),
          cwd:            ($meta.cwd            // null)
        }
    )
  | sort_by(.started // "")
  | reverse
'

# Read last 1000 lines (ring buffer capped at 500; defend against corruption).
folded="$(tail -n 1000 "$HISTORY_FILE" | jq -s "$FOLD_JQ" 2>/dev/null)" || {
  # shellcheck disable=SC2016
  printf 'Could not read delegation history (jq error). Path: `%s`.\n' "$HISTORY_FILE"
  exit 0
}

if [[ -z "$folded" || "$folded" == "[]" || "$folded" == "null" ]]; then
  printf 'No delegations recorded yet.\n'
  exit 0
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# format_duration <ms>  — "Nms" / "Ns" / "Xm Ys"
format_duration() {
  local ms="$1"
  if [[ -z "$ms" || "$ms" == "null" ]]; then
    printf '—'
    return
  fi
  local s=$(( ms / 1000 ))
  if   (( ms < 1000  )); then printf '%dms' "$ms"
  elif (( s  < 60    )); then printf '%ds'  "$s"
  else                        printf '%dm %ds' $(( s / 60 )) $(( s % 60 ))
  fi
}

# humanize <iso8601>  — "Ns ago" / "Nm ago" / "Nh ago" / "Nd ago"
humanize() {
  local ts="$1"
  if [[ -z "$ts" || "$ts" == "null" ]]; then
    printf '—'
    return
  fi
  local now_s started_s diff
  now_s="$(date +%s)"
  started_s="$(date -d "$ts" +%s 2>/dev/null)" || { printf '?'; return; }
  diff=$(( now_s - started_s ))
  (( diff < 0 )) && diff=0
  if   (( diff < 60   )); then printf '%ds ago'  "$diff"
  elif (( diff < 3600 )); then printf '%dm ago'  $(( diff / 60 ))
  elif (( diff < 86400)); then printf '%dh ago'  $(( diff / 3600 ))
  else                         printf '%dd ago'  $(( diff / 86400 ))
  fi
}

# trunc <str> <len>  — truncate to len chars, add … if longer
trunc() {
  local s="$1" maxlen="$2"
  if (( ${#s} > maxlen )); then
    printf '%s…' "${s:0:$(( maxlen - 1 ))}"
  else
    printf '%s' "$s"
  fi
}

# format_tokens <usage_json>
format_tokens() {
  local usage="$1"
  if [[ -z "$usage" || "$usage" == "null" ]]; then
    printf '—'
    return
  fi
  local it ot
  it="$(printf '%s' "$usage" | jq -r '.input_tokens // empty' 2>/dev/null)"
  ot="$(printf '%s' "$usage" | jq -r '.output_tokens // empty' 2>/dev/null)"
  if [[ -z "$it" && -z "$ot" ]]; then
    printf '—'
  else
    printf '%s/%s' "${it:-0}" "${ot:-0}"
  fi
}

# color_status <status>
color_status() {
  case "$1" in
    done)    printf '%s%s%s' "$GREEN"  "done"    "$RESET" ;;
    failed)  printf '%s%s%s' "$RED"    "failed"  "$RESET" ;;
    running) printf '%s%s%s' "$YELLOW" "running" "$RESET" ;;
    *)       printf '%s' "$1" ;;
  esac
}

# ---------------------------------------------------------------------------
# Mode: table
# ---------------------------------------------------------------------------
if [[ "$mode" == "table" ]]; then
  # Take first N entries (already sorted newest-first by fold).
  entries="$(printf '%s' "$folded" | jq --argjson n "$table_n" '.[:$n]' 2>/dev/null)"

  entry_count="$(printf '%s' "$entries" | jq 'length' 2>/dev/null)" || entry_count=0
  if [[ "$entry_count" -eq 0 ]]; then
    printf 'No delegations recorded yet.\n'
    exit 0
  fi

  # Print table header
  printf '| %-3s | %-11s | %-16s | %-40s | %-7s | %-8s | %-9s |\n' \
    "#" "When" "Type" "Description (≤40)" "Status" "Duration" "Tokens"
  printf '|-----|-------------|------------------|------------------------------------------|---------|----------|----------|\n'

  # Print rows
  local_idx=0
  while IFS= read -r entry; do
    local_idx=$(( local_idx + 1 ))
    s_type="$(printf '%s' "$entry" | jq -r '.subagent_type // "?"')"
    s_desc="$(printf '%s' "$entry" | jq -r '.description   // ""')"
    s_started="$(printf '%s' "$entry" | jq -r '.started    // ""')"
    s_status="$(printf '%s' "$entry" | jq -r '.status      // "?"')"
    s_dur="$(printf '%s' "$entry" | jq -r '.duration_ms    // empty')"
    s_usage="$(printf '%s' "$entry" | jq -c '.usage        // null')"

    when_str="$(humanize "$s_started")"
    dur_str="$(format_duration "${s_dur:-}")"
    tok_str="$(format_tokens "$s_usage")"
    desc_str="$(trunc "$s_desc" 40)"
    type_str="$(trunc "$s_type" 16)"
    status_colored="$(color_status "$s_status")"

    printf '| %-3s | %-11s | %-16s | %-40s | %s | %-8s | %-9s |\n' \
      "$local_idx" "$when_str" "$type_str" "$desc_str" "$status_colored" "$dur_str" "$tok_str"
  done < <(printf '%s' "$entries" | jq -c '.[]' 2>/dev/null)

  # shellcheck disable=SC2016
  printf '\nAsk me about entry `#N` for the full prompt and metrics.\n'
  exit 0
fi

# ---------------------------------------------------------------------------
# Mode: stats
# ---------------------------------------------------------------------------
if [[ "$mode" == "stats" ]]; then
  # If session_filter not provided, use the most recent entry's session_id.
  if [[ -z "$session_filter" ]]; then
    session_filter="$(printf '%s' "$folded" | jq -r '.[0].session_id // empty' 2>/dev/null)"
  fi

  if [[ -z "$session_filter" || "$session_filter" == "null" ]]; then
    printf 'No delegations in this session yet.\n'
    exit 0
  fi

  session_data="$(printf '%s' "$folded" | jq --arg sid "$session_filter" \
    '[.[] | select(.session_id == $sid)]' 2>/dev/null)"

  session_count="$(printf '%s' "$session_data" | jq 'length' 2>/dev/null)" || session_count=0

  if [[ "$session_count" -eq 0 ]]; then
    printf 'No delegations in this session yet.\n'
    exit 0
  fi

  # Compute stats via jq
  stats_json="$(printf '%s' "$session_data" | jq '
    (group_by(.subagent_type // "?") | map({
        type:   (.[0].subagent_type // "?"),
        count:  length,
        avg_ms: ((map(.duration_ms // 0) | add) / length),
        tokens: (map((.usage.input_tokens // 0) + (.usage.output_tokens // 0)) | add)
      })) as $by_type
    | {
        total:   length,
        by_type: $by_type,
        totals: {
          avg_ms:  ((map(.duration_ms // 0) | add) / (length | if . == 0 then 1 else . end)),
          tokens:  (map((.usage.input_tokens // 0) + (.usage.output_tokens // 0)) | add),
          failed:  (map(select(.status == "failed")) | length)
        }
      }
  ' 2>/dev/null)"

  total="$(printf '%s' "$stats_json" | jq -r '.total')"
  printf 'Session %s — %s delegations\n' "$session_filter" "$total"
  printf 'By type:\n'

  while IFS= read -r row; do
    r_type="$(printf '%s' "$row" | jq -r '.type')"
    r_count="$(printf '%s' "$row" | jq -r '.count')"
    r_avg_ms="$(printf '%s' "$row" | jq -r '.avg_ms | floor')"
    r_tokens="$(printf '%s' "$row" | jq -r '.tokens')"
    avg_dur="$(format_duration "$r_avg_ms")"

    # Format tokens with k suffix if >= 1000
    if (( r_tokens >= 1000 )); then
      tok_fmt="$(printf '%.1fk' "$(echo "scale=1; $r_tokens / 1000" | bc)")"
    else
      tok_fmt="$r_tokens"
    fi

    printf '  %-16s  ×%-4s avg %s   %s tok\n' "$r_type" "$r_count" "$avg_dur" "$tok_fmt"
  done < <(printf '%s' "$stats_json" | jq -c '.by_type[]' 2>/dev/null)

  # Totals line
  t_avg_ms="$(printf '%s' "$stats_json" | jq -r '.totals.avg_ms | floor')"
  t_tokens="$(printf '%s' "$stats_json" | jq -r '.totals.tokens')"
  t_failed="$(printf '%s' "$stats_json" | jq -r '.totals.failed')"
  t_avg_dur="$(format_duration "$t_avg_ms")"
  if (( t_tokens >= 1000 )); then
    t_tok_fmt="$(printf '%.1fk' "$(echo "scale=1; $t_tokens / 1000" | bc)")"
  else
    t_tok_fmt="$t_tokens"
  fi
  printf 'Totals: %s avg, %s tokens, %s failed\n' "$t_avg_dur" "$t_tok_fmt" "$t_failed"
  exit 0
fi

exit 0
