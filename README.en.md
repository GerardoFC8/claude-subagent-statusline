[Español](./README.md) | **English**

# claude-subagent-statusline

A Claude Code plugin that renders a live statusline showing your project folder, the active model and effort, estimated session cost, context window usage, real-time sub-agent (Task) counters, session elapsed time, and the 5h/7d rate-limit windows. Also persists a searchable history of every delegation across sessions. Pure Node.js (18+) — runs on Windows, macOS, and Linux.

## Preview

```
my-app [Opus 4.7 (high) · $1.42] ████░░░░░░ 42% │ ⏱ 14m 32s │ ⚡ 2 · ✓ 7 · ✗ 0 │ 5h: 13% (reset in 1h 8m) · Week: 4% (reset in 5d 15h)
```

### What the icons mean

| Icon | Meaning |
|---|---|
| `⚡` | Sub-agents (Tasks) **currently running** — includes both foreground (`Agent`) and background (`Agent` with `run_in_background: true`) launches |
| `✓` | Sub-agents that **completed** successfully |
| `✗` | Sub-agents that **failed** |
| `⏱` | **Elapsed time** since the session started |

### How each segment is built

**Project folder** (`my-app` in bold at the start) — basename of `workspace.current_dir`, with `cwd` as fallback. When the directory equals your `$HOME` (`$USERPROFILE` on Windows), the prefix renders as `~`. If neither field is in the payload, the prefix is omitted. Useful for distinguishing sessions when several Claude Code instances are open in different repos.

**Model bracket** (`[Opus 4.7 (high) · $1.42]`) — combines three pieces of info:
- *Model name*: parsed from `model.id` (e.g. `claude-opus-4-7` → `Opus 4.7`). If the field is missing or non-canonical, falls back to `model.display_name` with trailing `(1M context)` / `(200K context)` annotations stripped to keep the bracket compact.
- *Effort level*: in parentheses after the model name appears the live `effort.level` (`low`, `medium`, `high`, `xhigh`, or `max`). Reflects mid-session changes made via `/effort`. Omitted when the running model does not support the effort parameter.
- *Estimated cost*: the `· $X.XX` suffix shows the total session cost in USD, computed client-side by Claude Code. It accumulates every API call in the session — both the main agent **and** every sub-agent launched with the Task tool. If Claude Code does not expose the `cost` field, the suffix is omitted.

**Context bar** (`████░░░░░░ 42%`) — 10 cells wide, color-coded: green below 50%, yellow 50–79%, red 80%+. The sub-agent counters (`⚡` `✓` `✗`) and the `⏱` segment render unconditionally, even when their values are zero.

**Separator hierarchy** — the statusline uses two distinct separator characters with different meanings: `│` (heavy bar) marks **section breaks** (model bracket / bar and elapsed / counters / rate limits), while `·` (middle dot) separates **items inside a section** (between `⚡ ✓ ✗` and between `5h` and `Week`).

**Rate-limit windows** (`5h: X% (reset in …) · Week: X% (reset in …)`) — current usage of the 5-hour and 7-day rate-limit windows reported by Claude Code, alongside the time remaining until each window resets. The percentage uses the same color scale as the bar (green / yellow / red) so you can spot rate-limit pressure at a glance. The reset delta is formatted as `Xm` below one hour, `Xh Ym` below one day, or `Xd Yh` for longer windows. If your account does not expose rate limits, the whole segment is omitted.

## Per-subagent rows (model per sub-agent)

> Requires **Claude Code v2.1.205 or newer**. Older versions ignore the registration silently, so enabling it is always safe.

On top of the aggregate statusline, the plugin can render **one row per running sub-agent**, each leading with the **resolved model** that sub-agent runs on (`Opus 4.8`, `Haiku 4.5`, `Sonnet 5`, `Fable 5`…). It uses Claude Code's second statusline contract, `subagentStatusLine`: Claude Code pipes a single JSON object on stdin (`{ ...baseFields, columns, tasks[] }`) and the plugin writes one `{"id","content"}` line per row.

```
Opus 4.8 · explore · map the auth module 24%
Haiku 4.5 · writer · draft the changelog entry
```

Each row combines: the **model** (bold cyan; falls back to the `⋯` placeholder when Claude Code does not expose the task's model), the sub-agent **type/name** (dimmed), the **description** (truncated with `…` so the row stays within the terminal's `columns` width when there's room), and — when the payload provides it — the sub-agent's **context percentage** (`tokenCount / contextWindowSize`).

The renderer lives at `scripts/subagent-statusline.js` and is registered automatically under the `subagentStatusLine` key of `~/.claude/settings.json`, additively: it **never touches or changes your existing `statusLine`**. If you already have your own `subagentStatusLine`, the plugin leaves it intact and does not overwrite it.

## Install

```
claude plugin marketplace add GerardoFC8/claude-subagent-statusline
claude plugin install claude-subagent-statusline@claude-subagent-statusline
```

> **Restart Claude Code after install.** `settings.json` does not hot-reload — the plugin hooks will not fire until you fully restart the application.

## Updating to the latest version

If you already have the plugin installed and want to pull the most recent release:

```
claude plugin update claude-subagent-statusline@claude-subagent-statusline
```

**Restart Claude Code** after updating so the hooks get reloaded. The statusLine auto-configuration runs on every `SessionStart` and rewrites the absolute path of the script automatically so it points to the newly installed version — you do not need to touch `settings.json` by hand.

### Auto-update (optional)

If you'd rather have updates applied automatically on every Claude Code startup:

1. Run `/plugin` inside Claude Code
2. Switch to the **Marketplaces** tab
3. Select `claude-subagent-statusline`
4. Press **Enable auto-update**

Third-party marketplaces have auto-update disabled by default — you only need to flip it once. After that it's transparent: every time you start Claude Code, the plugin updates itself if there's a new version.

## Configuration

The plugin auto-configures itself on the first session after install:

- If you have **no `statusLine`** set → the plugin registers its renderer for you.
- If you already have **a custom `statusLine`** → the plugin leaves it intact and prints a one-line notice at session start with instructions to switch.
- **Before any modification**, the plugin saves a backup at `~/.claude/settings.json.<timestamp>.bak`.

To opt out of auto-configuration, set the environment variable `CSL_NO_AUTO_CONFIGURE=1`.

### Manual configuration (optional)

If you prefer to configure it by hand, add this to `~/.claude/settings.json` replacing `<PATH>` with the plugin's real install directory (you can find it in `~/.claude/plugins/installed_plugins.json`, field `installPath`):

```json
"statusLine": {
  "type": "command",
  "command": "node \"<PATH>/scripts/statusline.js\"",
  "refreshInterval": 30
}
```

> **Important**: use the absolute path. `${CLAUDE_PLUGIN_ROOT}` is only expanded inside a plugin's `hooks.json` — Claude Code does NOT substitute it in user `settings.json` `statusLine.command`. That is why the auto-configuration writes the absolute path and refreshes it on every plugin upgrade.

> **`refreshInterval`** controls how often (in seconds) Claude Code re-runs the statusline command even when there are no new messages. It keeps time-based segments — the 5h rate-limit countdown and the elapsed-time clock — live while you are idle. Auto-configure uses `30` by default; if you already have your own value, the plugin preserves it.

For the [per-subagent rows](#per-subagent-rows-model-per-sub-agent) (Claude Code v2.1.205+), also add the `subagentStatusLine` key pointing at the second script:

```json
"subagentStatusLine": {
  "type": "command",
  "command": "node \"<PATH>/scripts/subagent-statusline.js\""
}
```

## Coexistence with an existing statusLine

If you already have a statusLine renderer, you can read the delegation state from the JSONL file and append the counters to your existing output. The counter file lives at `~/.claude/state/delegations-<session_id>.jsonl`. Each entry has `id`, `status`, and `started` fields. Possible `status` values are `running`, `done`, `failed`, and `bg_launched` (the latter is a mapping line between `tool_use_id` and `agent_id` for background sub-agents launched with `run_in_background: true` — it is not a terminal state but is used by the `SubagentStop` hook to correlate actual completion). Unique-id counting by status (excluding `bg_launched`) gives you the running/done/failed totals.

## Persistent delegation history

Every Task delegation is recorded to a global JSONL file with full prompt, metadata, outcome, and the sub-agent's response text (truncated at 16 KB). The file is capped at 500 entries (ring buffer) and survives session boundaries.

Default location: `~/.claude/state/delegation-history.jsonl`
Custom location: set `CLAUDE_PLUGIN_DATA=/your/dir` — the plugin writes to `$CLAUDE_PLUGIN_DATA/history.jsonl`.

## Privacy note

The history file stores the **full prompt** and the **sub-agent's response text** (truncated at 16 KB) of every Task delegation. If your prompts or sub-agent responses contain sensitive information, review the file before sharing or committing. The file is local to your machine and never sent anywhere by this plugin.

## How it works

1. **SessionStart** fires when a new Claude Code session begins — checks `~/.claude/settings.json` and registers the plugin's `statusLine` if absent or if it points to an older version of this plugin (see [Configuration](#configuration)).
2. **PreToolUse** fires when Claude Code dispatches a Task delegation — the hook appends a `"running"` entry to the per-session counter file AND a full seed entry (including full prompt) to the global history file.
3. **PostToolUse** fires when the Task completes — the hook appends a `"done"` entry to both the counter file and the history file (with cost and token metrics).
4. **PostToolUseFailure** fires when the Task fails — the hook appends a `"failed"` entry to both files (metrics are null since failure payloads do not reliably carry cost data).
5. **SubagentStop** fires when a sub-agent actually completes — for foreground it is a silent tracking event with no action, but for background (where the prior `PostToolUse` wrote a `bg_launched` line with the `agent_id` instead of closing the entry), the hook looks up the original `tool_use_id` via `agent_id` and appends the corresponding `done` entry. This is what keeps the `⚡ running` counter honest while background sub-agents are truly in flight.
6. **`statusline.js`** reads the per-session counter JSONL, counts unique running/done/failed ids, computes session elapsed time from the oldest `started` entry, builds the progress bar from the context window percentage, and prints the formatted line on stdout.

All steps are stateless and append-only — no daemons, no locks, no in-place edits. The history file is trimmed atomically (temp-file + rename) when it exceeds 600 lines, keeping the last 500.

## Troubleshooting

**Hooks did not fire / counters stuck at 0**
Restart Claude Code. Hooks are registered at startup; a running instance does not pick up newly installed plugins.

**JSONL file not appearing in `~/.claude/state/`**
Verify the directory exists and is writable. If missing, create it:

- Linux/macOS: `mkdir -p ~/.claude/state`
- Windows (PowerShell): `New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\state"`

**Counter values look wrong**
Inspect the raw JSONL for the current session. **Foreground** delegations produce two lines: one with `"status":"running"` (from PreToolUse) and one with `"status":"done"` or `"status":"failed"` (from PostToolUse or PostToolUseFailure). **Background** delegations (`Agent` with `run_in_background: true`) produce **three**: the `running` from PreToolUse, a `bg_launched` with the `agent_id` (from PostToolUse when `tool_response.status === "async_launched"`), and finally a `done` from the `SubagentStop` hook when the sub-agent actually completes. If you see only running or `bg_launched` lines, the sub-agent may still be in flight or the corresponding hook has not fired yet.

## Known Limitations

**Concurrent JSONL append race on Windows (rare)**
`fs.appendFileSync` is not atomic across concurrent processes on Windows. If two hook invocations fire simultaneously for separate delegations, JSONL lines could be interleaved. In practice it is extremely rare because Task delegations are dispatched sequentially. If you hit it, the affected line(s) will produce a JSON parse error in the statusline (which is silently skipped), and the history will have a corrupt entry that is harmlessly ignored.

## Contributing

```bash
git clone https://github.com/GerardoFC8/claude-subagent-statusline.git
cd claude-subagent-statusline

# Requires Node.js 18+
node --version   # must be >= 18

# Run the full test suite
npm test
```

All changes must pass `npm test` (180 tests) with zero failures before merging. CI runs the full matrix on Ubuntu, macOS, and Windows on every push.

## License

MIT — see [LICENSE](LICENSE).
