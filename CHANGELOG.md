# Changelog

All notable changes to `claude-subagent-statusline` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.10.2] — 2026-05-07

### Added

- **Idle refresh for the statusline**: auto-configure now writes `"refreshInterval": 30` into the `statusLine` block of `~/.claude/settings.json`. Claude Code re-runs the statusline command on this interval in addition to its normal triggers (new assistant messages, `/compact`, permission/vim-mode changes), so time-based segments — the `5h` rate-limit countdown and the elapsed-time clock — stay live while the user is idle. Previously the statusline only refreshed when the user sent a message, which meant idle sessions saw a frozen countdown. Existing v0.10.1 installs are upgraded on the next `SessionStart` (the auto-configure flow now treats "command correct but no `refreshInterval`" as an `update` action). User-set values are preserved — if you already have your own `refreshInterval`, the plugin will not overwrite it.

### Changed

- **`scripts/lib/configure.js`** exports a new `DESIRED_REFRESH_INTERVAL = 30` constant and an enriched plan object (`desiredRefreshInterval`). `planAction` now considers `refreshInterval` presence when deciding `noop` vs `update`; `applyAction` writes the field while preserving any user-set value.
- **`scripts/auto-configure.js`** — the manual-configuration snippet shown to users with a custom statusline now includes `"refreshInterval": 30` so a copy-paste switch matches the auto-configured shape.
- **`README.md` / `README.en.md`** — the manual-configuration block now shows `refreshInterval: 30` and a short note explains why it is there.

### Updating

```
claude plugin update claude-subagent-statusline@claude-subagent-statusline
```

Restart Claude Code to apply. On the next `SessionStart` the plugin will add `"refreshInterval": 30` to your `statusLine` block automatically (a one-time `settings.json.<timestamp>.bak` is written for safety). To opt out of the refresh interval, edit `~/.claude/settings.json` and set your own value — the plugin will preserve it on subsequent runs.

---

## [0.10.1] — 2026-05-07

Post-release polish driven by a two-round adversarial review (`judgment-day` skill — two parallel blind judges on Sonnet, fix agent on Haiku, then re-judge). All findings here are post-v0.10.0 corrections. No runtime behavior change to the v0.10.0 contract.

### Fixed

- **Background agents no longer orphan their `running` entry when the `async_launched` payload omits `agentId`** (`scripts/track-delegation-post.js`). Previously the code exited without writing `bg_launched` AND without closing the entry — `findToolUseIdByAgentId` could never correlate it, so `⚡` was permanently over-counted by one. Now the missing-`agentId` branch falls through to the foreground `done` path: the entry closes early (slightly inaccurately) instead of being stuck running forever. Added `tests/track-post.test.js` coverage for both the counter and the history file.

- **Elapsed-time `<60s` branch and `secs % 60` modulo are now safe under floating-point inputs** (`scripts/statusline.js`). `Math.floor(secs)` is applied at the start of the elapsed segment so all downstream branches operate on integer seconds. Aligns with the same fix applied to `formatResetDelta` for the rate-limit reset countdown.

- **Test isolation**: `tests/statusline.test.js` "counter separators inside the counter group" no longer leaks a temp directory on every run (the test was creating two `mkTmpHome()` directories due to a shadowing bug; only the inner one was cleaned up).

- **`tests/manifest.test.js` now asserts the SubagentStop hook is registered** and validates its command path. Previously the test was named "four expected hook events" and never checked the v0.10.0 SubagentStop registration — accidental removal would have gone uncaught.

### Changed

- **`README.md` and `README.en.md`** — three sections updated to reflect the v0.10.0 model:
  - *Troubleshooting*: documents the 3-line JSONL pattern for background agents (`running` → `bg_launched` → `done`) alongside the 2-line foreground pattern.
  - *Coexistence with another statusLine*: documents `bg_launched` as a fourth status value with its mapping role, instructs external readers to exclude it from running/done/failed counts.
  - *How it works*: now lists 6 numbered steps including the SubagentStop hook explanation between PostToolUseFailure and `statusline.js`.
  - Test count bumped from 146 → 148 in the Contributing section.

- **`tests/history.test.js`** exports-completeness test now includes `findToolUseIdByAgentId` so future accidental removal of that export would be caught.

- **`CHANGELOG.md`** — v0.9.0 entry annotated with notes pointing readers to the v0.9.1 revisions of the effort format and the rate-limit separator. Helps anyone consulting historic entries from a rollback or audit.

### Updating

```
claude plugin update claude-subagent-statusline@claude-subagent-statusline
```

Restart Claude Code to apply.

---

## [0.10.0] — 2026-05-07

### Added

- **Accurate counter for background sub-agents**: when an `Agent` tool is invoked with `tool_input.run_in_background: true`, the sub-agent runs asynchronously — `PostToolUse` fires almost immediately with `tool_response.status: "async_launched"` while the actual work is still in progress (often 10s+ later). Until v0.10.0 the plugin treated that immediate `PostToolUse` as task completion, so background agents counted as `✓ done` the moment they were launched and never appeared as `⚡ running`. Now the plugin distinguishes the two flows:

  - **PreToolUse** captures `tool_input.run_in_background` into a `background: true` flag on the counter and history entries.
  - **PostToolUse** branches on `tool_response.status`. `async_launched` writes a lightweight `bg_launched` mapping line `{id, agent_id, status: "bg_launched"}` and **does not** close the entry. Foreground completions still write `done` exactly like before.
  - **`SubagentStop` (NEW hook)** is the actual completion signal for background agents. It receives the `agent_id` of the sub-agent that just finished, looks it up in the counter file via the `bg_launched` mapping, and writes a proper `done` entry against the original `tool_use_id`. For foreground sub-agents, `SubagentStop` fires too (just before `PostToolUse`) — but with no matching `bg_launched` entry it's a silent no-op, so foreground accounting stays unchanged.

  Net effect: `⚡ N` reflects the real number of sub-agents working at any moment, foreground and background alike. `✓ done` only ticks up when a sub-agent has actually finished.

- **`findToolUseIdByAgentId(sessionId, agentId)`** helper in `scripts/lib/history.js` — scans the per-session counter JSONL for the most recent entry whose `agent_id` matches and returns the corresponding `tool_use_id`, or `null` when no match (foreground case) or the file is missing.

- **`scripts/track-subagent-stop.js`** — new SubagentStop hook handler. Read-then-correlate-then-append, exit 0 in all paths, behaves silently for foreground.

### Changed

- **`scripts/track-delegation-pre.js`** captures `tool_input.run_in_background`. When true, sets `background: true` on the counter entry. Foreground entries stay byte-identical to the v0.9.x format (the `background` key is omitted on foreground to preserve compatibility with any external tooling that reads the counter file).
- **`scripts/track-delegation-post.js`** detects `tool_response.status === "async_launched"` and writes a `bg_launched` mapping instead of closing the entry. Existing foreground branch is unchanged.
- **`hooks/hooks.json`** registers the new `SubagentStop` event handler.

### Backward compatibility

The counter JSONL schema is additive only:
- Existing entries (without `background` or `agent_id` fields) keep their meaning.
- `bg_launched` is a new status string. `readCounters` ignores any status string outside `running` / `done` / `failed`, so the entry is invisible to the counter view but discoverable by `findToolUseIdByAgentId`.
- A user upgrading mid-session will see correct counts for any new sub-agent launched after the upgrade. In-flight background agents from before the upgrade may remain marked `done` (the way v0.9.x left them) — restarting Claude Code clears the per-session counter file.

---

## [0.9.1] — 2026-05-07

Visual polish patch — no contract changes, just statusline format refinements driven by user feedback.

### Changed

- **Effort level uses parentheses inside the bracket**: `[Opus 4.7 (high) · $20.48]` instead of `[Opus 4.7 · high · $20.48]`. Matches how Claude Code itself displays effort and reads more naturally.

- **Counter separators switched to `·`**: `⚡ 2 · ✓ 7 · ✗ 0` instead of `⚡ 2 │ ✓ 7 │ ✗ 0`. Counters are now visually grouped as a single section.

- **Section break before rate limits is `│`**: `✗ 0 │ 5h: …` instead of `✗ 0 · Ventana 5h: …`. Establishes a clean separator hierarchy — `│` between sections, `·` between items inside a section.

- **Rate-limit labels shortened and translated to English**: `Ventana 5h:` → `5h:`, `Semana:` → `Week:`. Saves ~10 characters and makes the line 100% English-or-symbol (matches `⏱`, `⚡`, `✓`, `✗`).

- **Reset countdown phrasing in English**: `(reset in Xh Ym)` instead of `(reset en Xh Ym)`. Same change driver.

### Updating

```
claude plugin update claude-subagent-statusline@claude-subagent-statusline
```

Restart Claude Code to apply.

---

## [0.9.0] — 2026-05-07

### Added

- **Project folder at the start of the line**: the statusline now begins with the basename of `workspace.current_dir` (with `cwd` as fallback), rendered in **bold ANSI** for visual hierarchy without emoji clutter. When the working directory equals `$HOME`/`$USERPROFILE`, the folder renders as `~`. If neither field is present in the payload, the folder prefix is omitted entirely. Useful for distinguishing sessions when several Claude Code instances are open in different repos.

- **Effort level inside the model bracket**: the current `effort.level` (`low` / `medium` / `high` / `xhigh` / `max`) appended to the model bracket as `[Opus 4.7 · high · $1.42]` (format later revised to `(high)` parens in v0.9.1 — see entry below). Reflects mid-session `/effort` changes. Omitted when the running model does not support the effort parameter.

- **Rate limit segments**: the statusline renders a `Ventana 5h: X% (reset en Yh Zm) · Semana: X% (reset en Yd Zh)` segment after the failed counter, showing the live percentage of the 5-hour and 7-day rate limits and the time remaining until each window resets. Read from `rate_limits.five_hour.{used_percentage, resets_at}` and `rate_limits.seven_day.{used_percentage, resets_at}` in the Claude Code statusline payload. The percentage is color-coded by threshold (green <50%, yellow 50–79%, red 80%+) — same scale as the context-window bar — so you can spot rate-limit pressure at a glance. Each window renders independently; if your account does not expose rate limits, the segment is omitted entirely.

- **Time delta formatter** for rate-limit reset countdowns: `Xm` under 1 hour, `Xh Ym` under 1 day, `Xd Yh` for longer windows. Past `resets_at` values render the percentage but suppress the "(reset en …)" suffix to avoid showing stale negative counts.

### Changed

- **Model name parsed from `model.id`**: when the payload exposes `model.id` like `claude-opus-4-7`, the bracket renders the parsed canonical form (`Opus 4.7`). When `model.id` is absent or non-canonical, the previous fallback runs: take `model.display_name` and strip any trailing `(... context)` annotation. The two-stage approach handles both extended-context variants (`Opus 4.7 (1M context)` → `[Opus 4.7]`) and any future model whose `id` may not match the regex.

- **Elapsed-time segment moved**: the `⏱` session-elapsed segment now renders right after the context-window bar and before the `⚡ running` counter, instead of after the `✗ failed` counter. Brings the session timer to the most prominent position next to the context bar.

- **Single `·` separator before the rate-limit segment** (instead of the compound `· │ ·` shipped briefly during iteration). Visually links rate limits as a continuous group with the failed counter while staying compact. *(Separator later promoted back to `│` in v0.9.1 to mark a clean section break — see entry below.)*

- **Sub-agent counter words dropped**: `⚡ 2 running | ✓ 7 done │ ✗ 0 failed` is now `⚡ 2 │ ✓ 7 │ ✗ 0`. Saves ~17 characters and uses a single `│` separator throughout the counter group for visual consistency. The README documents what each icon means in a dedicated table.

- **Folder prefix uses a plain space, not a separator**: the bold folder name at the start sits next to the model bracket separated only by a space (e.g. `my-app [Opus 4.7]`), instead of `my-app │ [Opus 4.7]`. The bold weight already provides enough visual hierarchy.

- **Internal**: extracted `colorForPct(pct)`, `clampPct(value)`, `parseModelFromId(id)`, and `basenameForFolder(cwd)` helpers so the bar, both rate-limit segments, model parsing, and folder normalization share single implementations.

---

## [0.7.0] — 2026-05-07

### Added

- **Session cost in statusline**: the model bracket now includes a `· $X.XX` suffix showing the estimated total session cost in USD, read from `cost.total_cost_usd` in the Claude Code statusline payload. The cost is computed client-side and accumulates every API call in the session — both the main agent AND every sub-agent launched with the Task tool. When the field is absent (older Claude Code versions), the suffix is omitted and the bracket stays as `[Model]`. Example: `[Sonnet 4.6 · $1.42] ████░░░░░░ 42% │ ⚡ 2 running | ✓ 7 done │ ✗ 0 failed │ ⏱ 14m 32s`.

### Changed

- **README simplified**: removed the redundant "Installing on Windows" / "Instalación en Windows" sections in both `README.md` and `README.en.md`. The main install block works identically on every supported platform — the OS-specific section was duplicated noise. Description and preview blocks updated to document the new cost suffix.

---

## [0.6.2] — 2026-05-06

### Fixed

- **Auto-configured `statusLine.command` was unusable** because `${CLAUDE_PLUGIN_ROOT}` is only expanded by Claude Code inside plugin-shipped `hooks.json`, not in user `~/.claude/settings.json`. Users who let v0.6.1's `SessionStart` hook run ended up with a literal placeholder in their settings, causing the statusline to silently disappear (Node could not resolve the script path).
- `auto-configure.js` now resolves the plugin's absolute install path at hook time (via `__dirname`) and writes that absolute path into `settings.json`. The path is rewritten on every plugin upgrade — no manual editing needed.
- `lib/configure.js` `desiredCommand(pluginRoot)` now requires an explicit absolute path; both legacy forms (bash wrapper, `${CLAUDE_PLUGIN_ROOT}` placeholder) are still classified as "ours" and auto-upgraded to the canonical absolute form.

### Recovery

If you upgraded to v0.6.1 and lost your statusline, simply update to v0.6.2 and start a new session — the SessionStart hook detects the broken placeholder form and rewrites `settings.json` automatically (with a backup, as always).

---

## [0.6.1] — 2026-05-06

### Added

- **Auto-configuration of `statusLine` on session start**: New `SessionStart` hook (`scripts/auto-configure.js`) idempotently configures `~/.claude/settings.json` so users no longer need to edit it manually after install or upgrade. Detects four states: missing → register, points to this plugin (any version or via wrapper) → upgrade in place, already correct → no-op, custom statusLine → leave intact and print a one-line notice.
- **Cross-platform CI matrix**: GitHub Actions now runs on Ubuntu, macOS, and Windows (Node 22) on every push.
- **Spanish-default README**: `README.md` is now Castilian Spanish; English moved to `README.en.md` with a language switcher in both files.

### Changed

- README "Configuration" section restructured to lead with auto-configuration; manual setup remains documented as an alternative.

### Safety

- `auto-configure.js` always backs up `settings.json` before any modification (`settings.json.<ISO>.bak`), uses atomic write (`tmp + rename`), refuses to write when the file is malformed JSON, and never throws to the user's session. Opt-out with `CSL_NO_AUTO_CONFIGURE=1`.

---

## [0.6.0] — 2026-05-06

### Added

- **Native Windows support**: The plugin now runs on Windows natively without WSL, MSYS2, or any shell emulation. Node.js 18+ is the only runtime requirement.

### Changed

- **Plugin runtime ported from bash to Node.js**: All three hook scripts (`track-delegation-pre`, `track-delegation-post`, `track-delegation-fail`), the statusline renderer (`statusline.js`), and the shared history library (`scripts/lib/history.js`) are now plain CommonJS modules. Minimum runtime: Node.js 18+.
- **Zero bash/shell dependencies**: `jq`, `bc`, GNU `date`, and `bash` are no longer required on any platform.
- **75-test Node.js test suite** replaces the bats/shellcheck suite. Run with `npm test`.

### Removed

- **`/subagents` slash command**: `commands/subagents.md` and `scripts/render-subagents.sh` have been deleted. There is no replacement slash command in v0.6.0.
- **`commands/` directory**: Removed entirely (was only used by `/subagents`).
- **`scripts/history-lib.sh`**: Replaced by `scripts/lib/history.js`.
- **`scripts/track-delegation-{pre,post,fail}.sh`**: Replaced by `.js` equivalents.
- **All bats test files and `tests/helpers.bash`**: Replaced by the Node.js test suite.

### Breaking

- **`statusLine.command` must be updated**: Users upgrading from v0.5.x must change `~/.claude/settings.json` from:
  ```
  "command": "bash \"${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh\""
  ```
  to:
  ```
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/statusline.js\""
  ```
  The plugin does not auto-migrate this field. Without this change, the statusline will stop rendering after upgrade.

### Known Limitations

- **Concurrent JSONL append race on Windows (rare)**: `fs.appendFileSync` is not atomic across concurrent processes on Windows. Identical severity to the v0.5.0 bash `>>` append race — not a regression. In practice this is extremely rare because Task delegations are dispatched sequentially.

---

## [0.3.1] — 2026-04-28

### Fixed

- **`render-subagents.sh` and `history-lib.sh` — wrong history file path when invoked outside hook subprocesses**:
  Claude Code only sets `CLAUDE_PLUGIN_DATA` in hook subprocesses. When `/subagents` was invoked
  via the Bash tool from a slash command, `CLAUDE_PLUGIN_DATA` was unset and both scripts fell
  back to `~/.claude/state/delegation-history.jsonl` — an essentially unused legacy path. The real
  history written by hooks lives at the per-plugin data convention path
  (`~/.claude/plugins/data/claude-subagent-statusline-claude-subagent-statusline/history.jsonl`).
  Fixed by introducing three-tier path resolution: (1) `$CLAUDE_PLUGIN_DATA/history.jsonl` when
  env is set, (2) the convention path when its directory exists, (3) the legacy state path as final
  fallback. For reads (`render-subagents.sh`), the first path with non-empty content wins.

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
