---
description: List, inspect, and aggregate sub-agent (Task) delegations recorded by claude-subagent-statusline.
allowed-tools: Bash, Read
argument-hint: "[N | stats | <index>]"
---

# /subagents — Delegation history viewer

You are answering a request to inspect the user's sub-agent delegation history. The plugin
`claude-subagent-statusline` writes one JSONL line per delegation lifecycle event to a global
history file. Your job is to read that file and render the requested view.

## Inputs

The user invocation may include ONE positional argument:

| Argument           | Meaning                                                          |
|--------------------|------------------------------------------------------------------|
| (no arg)           | Render the **table** of the last 20 delegations, newest first.   |
| `<N>` integer      | Render the table of the last N delegations (cap at 100).         |
| `stats`            | Render the **stats** block scoped to the current `session_id`.   |
| `#<N>` or `<N>` after a previous table render | Render the **detail** view for entry index N. |

Read `$ARGUMENTS` to decide which mode to run. If empty, default to `table` with N=20.

## Step 1 — Resolve history path

Run this Bash command and capture the path:

```bash
if [ -n "${CLAUDE_PLUGIN_DATA:-}" ]; then
  echo "${CLAUDE_PLUGIN_DATA}/history.jsonl"
else
  echo "${HOME}/.claude/state/delegation-history.jsonl"
fi
```

If the file does not exist or is empty, respond exactly:

> No delegations recorded yet.

…and stop.

## Step 2 — Fold the JSONL into one record per `tool_use_id`

The history is event-sourced: each `tool_use_id` may have a `running` seed entry plus a `done`
or `failed` finalization entry. Fold them with this jq pipeline (replace `<HISTORY>` with the
resolved path):

```bash
jq -s '
  group_by(.tool_use_id)
  | map(
      (first(.[] | select(.status == "running")) // null) as $seed
      | (first(.[] | select(.status == "failed")) // null) as $fail
      | (first(.[] | select(.status == "done"))   // null) as $ok
      | ($fail // $ok // $seed) as $final
      | {
          session_id:     (($seed // {}).session_id     // ($final // {}).session_id),
          tool_use_id:    (($seed // {}).tool_use_id    // ($final // {}).tool_use_id),
          subagent_type:  (($seed // {}).subagent_type  // null),
          description:    (($seed // {}).description    // null),
          prompt:         (($seed // {}).prompt         // null),
          started:        (($seed // {}).started        // null),
          ended:          (($final // {}).ended         // null),
          duration_ms:    (($final // {}).duration_ms   // null),
          status:         (($final // {}).status        // "running"),
          total_cost_usd: (($final // {}).total_cost_usd // null),
          usage:          (($final // {}).usage          // null),
          response:       (($final // {}).response       // null),
          cwd:            (($seed // {}).cwd            // null)
        }
    )
  | sort_by(.started // "")
  | reverse
' <HISTORY>
```

Catch jq errors silently and respond with the empty-state message.

## Step 3a — Mode `table` (default)

After folding, take the first N entries (default 20, max 100). Render this exact markdown
table with the column widths shown:

```
| #  | When        | Type             | Description (≤40)                       | Status  | Duration | Tokens   |
|----|-------------|------------------|-----------------------------------------|---------|----------|----------|
| 1  | 2m ago      | sdd-spec         | Write spec for delegation history       | done    | 1m 12s   | 3/7      |
| 2  | 5m ago      | sdd-design       | Lock contracts before tasks             | failed  | —        | —        |
| 3  | 11m ago     | general-purpose  | Explore alternatives for storage path   | done    | 18s      | 3200/8400|
```

Column rules:
- `#` — 1-based index, newest=1.
- `When` — humanized relative time from `started` (`Ns`, `Nm ago`, `Nh ago`, `Nd ago`).
- `Type` — `subagent_type` or `?` if null.
- `Description` — truncate to 40 chars with `…` suffix when needed.
- `Status` — `running` / `done` / `failed`. (Running rows emit `—` for Duration/Tokens.)
- `Duration` — from `duration_ms`: `<1000ms` → `Nms`, `<60000` → `Ns`, else `Xm Ys`.
- `Tokens` — `in/out` format from `usage.input_tokens`/`usage.output_tokens`, or `—` when null.

After the table append exactly:

> Ask me about entry `#N` for the full prompt and metrics.

## Step 3b — Mode `stats`

Filter the folded records to the **current session** (you can read `session_id` from the
ambient context — for slash commands it is available as the current Claude Code session id).
If you don't know it, run `jq -r '.[0].session_id' <FOLDED>` from the most recent entry as a
best-effort fallback. If zero entries match, respond:

> No delegations in this session yet.

Otherwise render this exact block:

```
Session <session_id> — <total> delegations
By type:
  <type-padded-14>  ×<N>   avg <duration>   <tokens> tok
  ...
Totals: <avg-duration> avg, <sum-tokens> tokens, <failed-count> failed
```

Aggregations (jq):

```bash
jq --arg sid "<SESSION>" '
  map(select(.session_id == $sid))
  | (group_by(.subagent_type // "?") | map({
      type:     (.[0].subagent_type // "?"),
      count:    length,
      avg_ms:   ((map(.duration_ms // 0) | add) / length),
      tokens:   (map((.usage.input_tokens // 0) + (.usage.output_tokens // 0)) | add)
    })) as $by_type
  | {
      session_id: $sid,
      total: length,
      by_type: $by_type,
      totals: {
        avg_ms:  ((map(.duration_ms // 0) | add) / (length | if . == 0 then 1 else . end)),
        tokens:  (map((.usage.input_tokens // 0) + (.usage.output_tokens // 0)) | add),
        failed:  (map(select(.status == "failed")) | length)
      }
    }
'
```

Format duration the same way as the table mode. Format tokens with a
thousands separator (e.g. `8.4k` for ≥1000, otherwise raw integer).

Note: `total_cost_usd` is always null in current Claude Code PostToolUse payloads — cost aggregation
is intentionally omitted from the stats block. The field is retained in the history schema for
forward compatibility if Claude Code begins populating it in a future release.

Failed entries MUST NOT contribute to the cost/token sums (their values are null and `// 0` is
correct only because null → 0; verify by adding `select(.status != "failed")` before the cost
sum if needed).

## Step 3c — Mode `detail` (`/subagents <N>` after a prior table render)

If the user asks "show me #3" or invokes `/subagents 3` AFTER a table was rendered (rare; the
plugin treats single-digit args ≤ 100 as N for the table, so detail is mostly conversational —
"show me entry 3"), produce:

```
### Delegation #<N> — <subagent_type> · <status>

**Description:** <description>
**When:** <started> (<elapsed-since>)
**Duration:** <duration> · **Tokens:** <input>/<output>
**CWD:** <cwd>

**Prompt:**

```
<full untruncated prompt>
```

## Response

```
<response text>
```

_(no response captured)_ — render this literal string when `response` is null or absent.
```

Use a fenced code block for the prompt and response so multiline/markdown content renders verbatim.
If `response` is null or absent, show `_(no response captured)_` instead of the code block.

## Hard caps

- Table: never render more than 100 rows even if the user passes `/subagents 99999`.
- Read at most the last 1000 lines of the history file (the ring buffer caps it at 500 lines,
  but defend against corruption): `tail -n 1000 <HISTORY> | jq -s ...`.

## Error handling

If any jq pipeline fails, respond with:

> Could not read delegation history (jq error). Path: `<HISTORY>`.

Do not include stack traces.
