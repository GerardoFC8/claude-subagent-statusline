[Español](./README.md) | **English**

# claude-subagent-statusline

A Claude Code plugin that tracks Task (sub-agent) delegations in real time and renders a live statusline showing your context window usage alongside delegation counts and session elapsed time. Persists a searchable history of every delegation across sessions. Pure Node.js (18+) — runs on Windows, macOS, and Linux.

## Preview

```
[Opus 4.7] ████░░░░░░ 42% │ ⚡ 2 running | ✓ 7 done │ ✗ 0 failed │ ⏱ 14m 32s
```

The bar is 10 cells wide and color-coded: green below 50%, yellow 50–79%, red 80%+. Both `✗ failed` and `⏱` segments render unconditionally — you get `✗ 0 failed` and `⏱ 0s` from the very first statusline call.

## Install

```
claude plugin marketplace add GerardoFC8/claude-subagent-statusline
claude plugin install claude-subagent-statusline
```

> **Restart Claude Code after install.** `settings.json` does not hot-reload — the plugin hooks will not fire until you fully restart the application.

## Configuration

The plugin auto-configures itself on the first session after install:

- If you have **no `statusLine`** set → the plugin registers its renderer for you.
- If you already have **a custom `statusLine`** → the plugin leaves it intact and prints a one-line notice at session start with instructions to switch.
- **Before any modification**, the plugin saves a backup at `~/.claude/settings.json.<timestamp>.bak`.

To opt out of auto-configuration, set the environment variable `CSL_NO_AUTO_CONFIGURE=1`.

### Manual configuration (optional)

If you prefer to configure it by hand, add this to `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/statusline.js\""
}
```

On Windows, `${CLAUDE_PLUGIN_ROOT}` expands to a Windows path. Forward slashes work; alternatively use a fully-qualified path: `node "C:\\Users\\you\\.claude\\plugins\\...\\scripts\\statusline.js"`.

> **Note on the path**: `${CLAUDE_PLUGIN_ROOT}` is a Claude Code variable resolved at runtime. If you want a stable reference that survives plugin updates, copy `scripts/statusline.js` to a fixed location and point `settings.json` at it directly.

## Installing on Windows

1. Install Node.js 18 or later from [nodejs.org](https://nodejs.org/). The LTS release is recommended.
2. Install the plugin:
   ```
   claude plugin marketplace add GerardoFC8/claude-subagent-statusline
   claude plugin install claude-subagent-statusline
   ```
3. Restart Claude Code.
4. Edit `~/.claude/settings.json` and set `statusLine.command` to the `node` form shown above.

No WSL, MSYS2, or shell emulation required. The plugin is pure Node.js.

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

All changes must pass `npm test` (75 tests) with zero failures before merging. CI runs the full matrix on Ubuntu, macOS, and Windows on every push.

## License

MIT — see [LICENSE](LICENSE).
