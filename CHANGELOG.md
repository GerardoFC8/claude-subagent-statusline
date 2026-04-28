# Changelog

All notable changes to `claude-subagent-statusline` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] — 2026-04-28

### Removed

- **In-flight winner segment (`▶ ...`)**: The `▶ <type>: "<desc>" (<elapsed>)` segment and the
  `⚠` stale prefix (>30 min running) have been removed from the statusline. Long-running agents
  are normal and the misleading stale marker was causing confusion.

### Added

- **Session elapsed segment (`⏱`)**: The statusline now shows how long the current Claude Code
  session has been alive, computed from the oldest `started` timestamp in the per-session counter
  file. Format: `Xs` < 1 min, `Xm Ys` < 1 h, `Xh Ym` otherwise. Segment omitted if no counter
  file exists (no delegations yet).

- **`scripts/render-subagents.sh`**: Token-free bash renderer for the `/subagents` slash command.
  Implements all three modes (table, stats, detail) by reading the history JSONL directly and
  printing ANSI-colored output. Replaces the heavy LLM-driven jq pipeline in `commands/subagents.md`.

- **Cache token fields** (bonus): `track-delegation-post.sh` now captures
  `cache_read_input_tokens` and `cache_creation_input_tokens` from `tool_response.usage.*`,
  and `total_tool_use_count` from `tool_response.totalToolUseCount`. All three are recorded in
  the history entry's `usage` object and `total_tool_use_count` top-level field respectively.

### Changed

- **`/subagents` slash command** (`commands/subagents.md`): Reduced from ~200 lines of LLM
  instructions to a 10-line thin passthrough that runs `render-subagents.sh "$ARGUMENTS"` and
  prints stdout verbatim. Near-zero token cost per invocation (was ~5K tokens).

- **EMPIRICAL comments removed**: Resolved historical investigation notes cleaned up from
  `scripts/track-delegation-pre.sh` (G1 confirmed) and `scripts/track-delegation-fail.sh`
  (G3 documented as known limitation with a concise one-liner).

---

## [0.2.1] — 2026-04-28

### Fixed

- **`/subagents` jq fold pipeline — null-binding collapse bug**: The Step 2 pipeline used
  `(.[] | select(.status == "X")) as $name` for each of `running`, `failed`, and `done`.
  When a `tool_use_id` group had no entry for a given status (e.g. a successful delegation
  has running + done but no failed), jq returned empty from `select`, which silently collapsed
  the entire surrounding `map` path and produced `[]` for that group. The rendered table showed
  `?` for Type and Description for those entries (the success-path majority). Fixed by replacing
  every bare select binding with `(first(.[] | select(.status == "X")) // null) as $name` and
  guarding all downstream field accesses with `($var // {}).field` to tolerate null bindings
  without further errors.

---

## [0.2.0] — 2026-04-28

### Added

- **Persistent delegation history** (`scripts/history-lib.sh`, sourced by pre/post/fail hooks):
  - Global append-only JSONL ring buffer capped at 500 entries (trim threshold: 600, atomic via temp+mv).
  - Path resolution: `${CLAUDE_PLUGIN_DATA}/history.jsonl` when env is set, else `${HOME}/.claude/state/delegation-history.jsonl`.
  - Full seed entry written on PreToolUse (includes full prompt, subagent_type, description, cwd, session_id, tool_use_id).
  - Finalization entry appended on PostToolUse/PostToolUseFailure (adds ended, duration_ms, total_cost_usd, usage tokens).

- **`/subagents` slash command** (`commands/subagents.md`):
  - Default: markdown table of last 20 delegations, newest first. Columns: #, When, Type, Description (≤40), Status, Duration, Cost.
  - `stats` sub-flag: per-type aggregates + session totals scoped to current session_id.
  - Detail follow-up: show full untruncated prompt + all metrics for entry #N.
  - Hard cap: 100 rows max regardless of N argument.

- **PostToolUseFailure hook** (`scripts/track-delegation-fail.sh`, `hooks/hooks.json`):
  - New hook script mirrors post.sh but sets `status:"failed"` and nulls all metrics.
  - `hooks/hooks.json` declares `PostToolUseFailure` matcher for `Task` with `async:true`.

- **In-flight statusline segment** (statusline.sh):
  - `▶ <type>: "<desc>" (<elapsed>)` shows the oldest-started running delegation.
  - Elapsed format: `Xs` / `Xm Ys` / `Xh Ym`.
  - Description truncated to 30 chars with `…` suffix.
  - `⚠ ▶ ...` prefix when in-flight entry has been running > 30 minutes.

- **Failed counter segment** (statusline.sh):
  - `✗ N failed` appended to statusline output when N > 0 (counted from per-session counter file).
  - Absent when N = 0.

### Changed

- **Statusline output format** (BREAKING):
  - In-flight `▶` segment inserted before the `⚡ N running` counter.
  - Trailing `|` removed from done segment; `│` (U+2502) used consistently.
  - `✗ N failed` appended when failures exist.
  - Zero-state output (no running, no failed) is byte-identical to v0.1.0.

- **`track-delegation-pre.sh`**: in addition to existing counter write, now also writes a history seed entry via `history-lib.sh`.
- **`track-delegation-post.sh`**: in addition to existing counter write, now also appends a history finalization entry via `history-lib.sh`.
- **`plugin.json` version**: `0.1.0` → `0.2.0`. Description updated to mention persistent history and slash command.

### Fixed

- Statusline double-count bug: a `failed` id with no `done` line was previously counted as both "running" and (after this fix) "failed". Fixed by extending the running set arithmetic to subtract both done and failed ids: `running = R - D - F`.

---

## [0.1.0] — 2026-04-27

### Added

- **PreToolUse hook** (`scripts/track-delegation-pre.sh`): appends a lean `"running"` entry to `~/.claude/state/delegations-<session_id>.jsonl` on Task dispatch.
- **PostToolUse hook** (`scripts/track-delegation-post.sh`): appends a lean `"done"` entry for the same `tool_use_id` on Task completion.
- **Statusline renderer** (`scripts/statusline.sh`): reads session JSONL, counts running/done, builds a color-coded context window progress bar, and prints a formatted statusline line.
- **`hooks/hooks.json`**: declares `PreToolUse` and `PostToolUse` matchers for `Task` with `async:true`.
- **`plugin.json`**: plugin manifest with name, version, author, repository fields.
- **Full bats test suite** covering all hook scripts, statusline renderer, and manifest.
- **GitHub Actions CI** (`ci.yml`): runs shellcheck, bats, and jq manifest validation on every push and pull request.
