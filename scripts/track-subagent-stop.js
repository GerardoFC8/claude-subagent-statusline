#!/usr/bin/env node
// scripts/track-subagent-stop.js — SubagentStop hook.
// Correlates a background sub-agent's completion to its original Agent
// delegation by `agent_id`, then writes a "done" entry to the per-session
// counter file (and to the global history) so the statusline counters
// transition from running → done at the right time.
//
// No-op for foreground sub-agents — their PostToolUse already wrote `done`,
// and the SubagentStop's agent_id won't match any `bg_launched` entry, so
// findToolUseIdByAgentId returns null and we exit without writing.
//
// Exit 0 in ALL paths (consistent with the other hooks).
'use strict';
const fs = require('fs');
const lib = require('./lib/history');

try {
  const payload = (() => { try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; } })();
  let p = null;
  try { p = JSON.parse(payload); } catch (_) { process.exit(0); }
  if (!p || typeof p !== 'object') process.exit(0);

  const sessionId = typeof p.session_id === 'string' ? p.session_id : '';
  const agentId   = typeof p.agent_id   === 'string' ? p.agent_id   : '';
  if (!sessionId || !agentId) process.exit(0);

  const toolUseId = lib.findToolUseIdByAgentId(sessionId, agentId);
  if (!toolUseId) process.exit(0); // foreground or unknown — skip silently

  const ended = lib.nowIsoZ();
  lib.counterAppend(sessionId, {
    id: toolUseId,
    ended,
    status: 'done',
  });
  lib.historyAppend({
    session_id: sessionId,
    tool_use_id: toolUseId,
    agent_id: agentId,
    ended,
    status: 'done',
  });
} catch (_) { /* swallow any unexpected error */ }

process.exit(0);
