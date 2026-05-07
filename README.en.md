[Español](./README.md) | **English**

# claude-subagent-statusline

A Claude Code plugin that tracks Task (sub-agent) delegations in real time and renders a live statusline showing your context window usage, estimated session cost, rate-limit windows (5h and 7d), delegation counts, and session elapsed time. Persists a searchable history of every delegation across sessions. Pure Node.js (18+) — runs on Windows, macOS, and Linux.

## Preview

```
[Opus 4.7 · $1.42] ████░░░░░░ 42% │ ⚡ 2 running | ✓ 7 done │ ✗ 0 failed │ ⏱ 14m 32s │ 🪟 Ventana 5h: 13% (reset en 1h 8m) · Semana: 4% (reset en 5d 15h)
```

The bar is 10 cells wide and color-coded: green below 50%, yellow 50–79%, red 80%+. Both `✗ failed` and `⏱` segments render unconditionally — you get `✗ 0 failed` and `⏱ 0s` from the very first statusline call.

The `· $X.XX` suffix inside the model bracket shows the estimated total session cost in USD, computed client-side by Claude Code. It accumulates the cost of every API call during the session — including the main agent AND every sub-agent launched with the Task tool. If your Claude Code version does not expose the `cost` field, the suffix is omitted and the bracket stays as `[Model]`.

The `🪟 Ventana 5h: X% (reset en …) · Semana: X% (reset en …)` segment shows the live usage of the 5-hour and 7-day rate-limit windows reported by Claude Code, alongside the time remaining until each window resets. The percentage uses the same color scale as the bar (green / yellow / red) so you can spot rate-limit pressure at a glance. The reset delta is formatted as `Xm` below one hour, `Xh Ym` below one day, or `Xd Yh` for longer windows. The labels are intentionally Spanish ("Ventana" = window, "Semana" = week) — if your account does not expose rate limits, the whole segment is omitted.

The model name is normalized by stripping trailing `(... context)` annotations to keep the bracket compact. When Claude Code reports `Opus 4.7 (1M context)`, the statusline shows `[Opus 4.7]`. Plain names without that annotation are preserved unchanged.

## Install

```
claude plugin marketplace add GerardoFC8/claude-subagent-statusline
claude plugin install claude-subagent-statusline@claude-subagent-statusline
```

> **Restart Claude Code after install.** `settings.json` does not hot-reload — the plugin hooks will not fire until you fully restart the application.

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
  "command": "node \"<PATH>/scripts/statusline.js\""
}
```

> **Important**: use the absolute path. `${CLAUDE_PLUGIN_ROOT}` is only expanded inside a plugin's `hooks.json` — Claude Code does NOT substitute it in user `settings.json` `statusLine.command`. That is why the auto-configuration writes the absolute path and refreshes it on every plugin upgrade.

## Coexistence with an existing statusLine

If you already have a statusLine renderer, you can read the delegation state from the JSONL file and append the counters to your existing output. The counter file lives at `~/.claude/state/delegations-<session_id>.jsonl`. Each entry has `id`, `status` (`running` | `done` | `failed`), and `started` fields. Unique-id counting gives you the running/done/failed totals.

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
5. **`statusline.js`** reads the per-session counter JSONL, counts unique running/done/failed ids, computes session elapsed time from the oldest `started` entry, builds the progress bar from the context window percentage, and prints the formatted line on stdout.

All steps are stateless and append-only — no daemons, no locks, no in-place edits. The history file is trimmed atomically (temp-file + rename) when it exceeds 600 lines, keeping the last 500.

## Troubleshooting

**Hooks did not fire / counters stuck at 0**
Restart Claude Code. Hooks are registered at startup; a running instance does not pick up newly installed plugins.

**JSONL file not appearing in `~/.claude/state/`**
Verify the directory exists and is writable. If missing, create it:

- Linux/macOS: `mkdir -p ~/.claude/state`
- Windows (PowerShell): `New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\state"`

**Counter values look wrong**
Inspect the raw JSONL for the current session. Each delegation produces two lines: one with `"status":"running"` (from PreToolUse) and one with `"status":"done"` or `"status":"failed"` (from PostToolUse or PostToolUseFailure). If you see only running lines, the PostToolUse hook may not have fired yet or the task is still in progress.

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

All changes must pass `npm test` (117 tests) with zero failures before merging. CI runs the full matrix on Ubuntu, macOS, and Windows on every push.

## License

MIT — see [LICENSE](LICENSE).
