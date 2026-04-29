# claude-subagent-statusline

A Claude Code plugin that tracks Task (sub-agent) delegations in real time, renders a live statusline showing your context window usage alongside delegation counts and session elapsed time, and persists a searchable history of every delegation across sessions.

## What's new in v0.4.0

### Always-on `✗ failed` and `⏱` segments

Both segments now render unconditionally — `✗ 0 failed` even when there are no failures, and `⏱ 0s` from the very first statusline call, even before any sub-agent has been dispatched.

To achieve `⏱` before the first delegation, the script persists a session-start epoch to `~/.claude/state/session-start-<session_id>` on first run and uses it as the elapsed baseline when no JSONL entries carry a `started` field.

**v0.4.0 statusline format (always complete):**
```
[Opus 4.7] ████░░░░░░ 42% │ ⚡ 2 running | ✓ 7 done │ ✗ 0 failed │ ⏱ 14m 32s
```

With failures:
```
[Opus 4.7] ████░░░░░░ 42% │ ⚡ 2 running | ✓ 7 done │ ✗ 1 failed │ ⏱ 14m 32s
```

### Token-free `/subagents` command

`/subagents` now runs a bash script (`scripts/render-subagents.sh`) directly instead of asking the LLM to interpret a 200-line prompt. Near-zero token cost per invocation (was ~5K tokens). Output format is unchanged.

### `/subagents` slash command

Invoke `/subagents` in any Claude Code conversation to inspect your delegation history:

```
/subagents           # table of last 20 delegations, newest first
/subagents 50        # table of last 50 (cap at 100)
/subagents stats     # per-type aggregates for this session
```

Example table output:

```
| #  | When    | Type        | Description (≤40)                  | Status | Duration | Tokens      |
|----|---------|-------------|-------------------------------------|--------|----------|-------------|
| 1  | 2m ago  | sdd-spec    | Write spec for delegation history   | done   | 1m 12s   | 3/7         |
| 2  | 5m ago  | sdd-design  | Lock contracts before tasks         | failed | —        | —           |
| 3  | 11m ago | sdd-apply   | Implement history-lib.sh            | done   | 18s      | 3200/8400   |
```

### Persistent delegation history

Every Task delegation is recorded to a global JSONL file with full prompt, metadata, outcome, and the sub-agent's response text (truncated at 16 KB). The file is capped at 500 entries (ring buffer) and survives session boundaries. History now also captures `cache_read_input_tokens`, `cache_creation_input_tokens`, and `total_tool_use_count` from the PostToolUse payload.

Default location: `~/.claude/state/delegation-history.jsonl`
Custom location: set `CLAUDE_PLUGIN_DATA=/your/dir` — the plugin writes to `$CLAUDE_PLUGIN_DATA/history.jsonl`.

### Environment variable fallback

All history-writing scripts respect:

```
CLAUDE_PLUGIN_DATA=/custom/path  →  /custom/path/history.jsonl
(unset)                          →  ~/.claude/state/delegation-history.jsonl
```

The counter file (for the statusline) remains at `~/.claude/state/delegations-<session_id>.jsonl` and is unaffected by `CLAUDE_PLUGIN_DATA`.

---

## Preview

```
[Opus 4.7] ████░░░░░░ 42% │ ⚡ 2 running | ✓ 7 done │ ✗ 0 failed │ ⏱ 14m 32s
```

The bar is 10 cells wide and color-coded: green below 50%, yellow 50–79%, red 80%+.

## Install

```bash
claude plugin marketplace add GerardoFC8/claude-subagent-statusline
claude plugin install claude-subagent-statusline
```

> **Restart Claude Code after install.** `settings.json` does not hot-reload — the plugin hooks will not fire until you fully restart the application.

## Configure your statusLine

The plugin registers the tracking hooks automatically, but it does **not** set your `statusLine` field. You must add this snippet to `~/.claude/settings.json` yourself:

```json
"statusLine": {
  "type": "command",
  "command": "bash ~/.claude/plugins/<resolved-path>/scripts/statusline.sh"
}
```

> **Note on the path**: `<resolved-path>` is not auto-discoverable. After running `claude plugin install`, check where the plugin was installed (typically somewhere under `~/.claude/plugins/`) and substitute the actual directory name. If you want a stable reference that survives plugin updates, copy `statusline.sh` to a fixed location:
>
> ```bash
> cp ~/.claude/plugins/<resolved-path>/scripts/statusline.sh ~/.claude/statusline.sh
> ```
>
> Then point `settings.json` at `~/.claude/statusline.sh` instead.

## Coexistence with an existing statusLine

If you already have a statusLine renderer, you do not need to replace it. Read the delegation state from the JSONL file and append the counters to your existing output:

```bash
#!/usr/bin/env bash
# Your existing statusline logic here...
existing_output="$(your-existing-renderer)"

session_id="$(printf '%s' "$1" | jq -r '.session_id // empty')"
state_file="${HOME}/.claude/state/delegations-${session_id}.jsonl"

running=0
done_count=0
if [[ -n "$session_id" && -r "$state_file" ]]; then
  done_count=$(jq -rs 'map(select(.status=="done") | .id) | unique | length' "$state_file" 2>/dev/null || echo 0)
  running=$(jq -rs '(map(select(.status=="done") | .id) | unique) as $d | (map(select(.status=="running") | .id) | unique) as $r | ($r - $d) | length' "$state_file" 2>/dev/null || echo 0)
fi

printf '%s │ ⚡ %d running │ ✓ %d done\n' "$existing_output" "$running" "$done_count"
```

## Privacy note

The history file stores the **full prompt** and the **sub-agent's response text** (truncated at 16 KB) of every Task delegation. If your prompts or sub-agent responses contain sensitive information, review the file before sharing or committing. The file is local to your machine and never sent anywhere by this plugin.

To disable history recording while keeping the statusline, remove the `source history-lib.sh` and `history_append` lines from `track-delegation-pre.sh` and `track-delegation-post.sh`. The counter file and statusline will continue to work unchanged.

## Troubleshooting

**Hooks did not fire / counters stuck at 0**
Restart Claude Code. Hooks are registered at startup; a running instance does not pick up newly installed plugins.

**JSONL file not appearing in `~/.claude/state/`**
Verify the directory exists and is writable:
```bash
ls -la ~/.claude/state/
```
If missing, create it: `mkdir -p ~/.claude/state`

**Counter values look wrong**
Inspect the raw JSONL for the current session:
```bash
cat ~/.claude/state/delegations-*.jsonl | jq .
```
Each delegation produces two lines: one with `"status":"running"` (from PreToolUse) and one with `"status":"done"` or `"status":"failed"` (from PostToolUse or PostToolUseFailure). If you see only running lines, the PostToolUse hook may not have fired yet or the task is still in progress.

**`/subagents` shows no history**
The history file lives at `~/.claude/state/delegation-history.jsonl` by default. If `CLAUDE_PLUGIN_DATA` is set in your environment, check `$CLAUDE_PLUGIN_DATA/history.jsonl` instead.

## How it works

1. **PreToolUse** fires when Claude Code dispatches a Task delegation — the hook appends a `"running"` entry to the per-session counter file AND a full seed entry (including full prompt) to the global history file.
2. **PostToolUse** fires when the Task completes — the hook appends a `"done"` entry to both the counter file and the history file (with cost and token metrics).
3. **PostToolUseFailure** fires when the Task fails — the hook appends a `"failed"` entry to both files (metrics are null since failure payloads do not reliably carry cost data).
4. **`statusline.sh`** reads the per-session counter JSONL, counts unique running/done/failed ids, computes session elapsed time from the oldest `started` entry, builds the progress bar from the context window percentage, and prints the formatted line on stdout.
5. **`/subagents`** invokes `scripts/render-subagents.sh` (token-free), which reads the global history JSONL, folds running+finalization entries by `tool_use_id`, and renders the requested view (table or stats).

All steps are stateless and append-only — no daemons, no locks, no in-place edits. The history file is trimmed atomically (temp-file + rename) when it exceeds 600 lines, keeping the last 500.

## Contributing

```bash
git clone https://github.com/GerardoFC8/claude-subagent-statusline.git
cd claude-subagent-statusline

# Install test dependencies (Ubuntu/Debian)
sudo apt-get install -y bats shellcheck jq

# macOS
brew install bats-core shellcheck jq

# Run the full test suite
bats tests/
```

PRs are welcome. All scripts must pass `shellcheck scripts/*.sh` with zero warnings, and `bats tests/` must be fully green before merging.

## License

MIT — see [LICENSE](LICENSE).
