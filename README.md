# claude-subagent-statusline

A Claude Code plugin that tracks Task (sub-agent) delegations in real time and renders a live statusline showing your context window usage alongside running and completed delegation counts.

## Preview

```
[Opus 4.7] ████░░░░░░ 42% │ ⚡ 2 running | ✓ 7 done |
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

printf '%s │ ⚡ %d running | ✓ %d done |\n' "$existing_output" "$running" "$done_count"
```

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
Each delegation produces two lines: one with `"status":"running"` (from PreToolUse) and one with `"status":"done"` (from PostToolUse). If you see only running lines, the PostToolUse hook may not have fired yet or the task is still in progress.

## How it works

1. **PreToolUse** fires when Claude Code dispatches a Task delegation — the hook appends a `"running"` entry to `~/.claude/state/delegations-<session_id>.jsonl`.
2. **PostToolUse** fires when the Task completes — the hook appends a `"done"` entry for the same `tool_use_id`.
3. **`statusline.sh`** reads the JSONL, counts unique running and done ids, builds the progress bar from the context window percentage, and prints the formatted line on stdout.

All three steps are stateless and append-only — no daemons, no locks, no in-place edits.

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
