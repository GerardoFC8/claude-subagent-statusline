---
description: List, inspect, and aggregate sub-agent (Task) delegations recorded by claude-subagent-statusline.
allowed-tools: Bash
argument-hint: "[N | all [N] | stats | <index>]"
---

Run this exact bash command and print its stdout verbatim with no commentary, no markdown wrapping, and no analysis:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/render-subagents.sh" "$ARGUMENTS"
```
