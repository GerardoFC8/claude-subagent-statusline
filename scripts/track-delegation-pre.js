#!/usr/bin/env node
// scripts/track-delegation-pre.js — PreToolUse hook.
// Appends a lean "running" entry to the per-session JSONL counter file
// AND a full "running" seed entry to the global history file.
// Exit 0 in ALL paths (REQ-HISTORY-108).
'use strict';
const fs = require('fs');
const lib = require('./lib/history');

try {
  const payload = (() => { try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; } })();
  let p = null;
  try { p = JSON.parse(payload); } catch (_) { process.exit(0); }
  if (!p || typeof p !== 'object') process.exit(0);

  const sessionId = typeof p.session_id  === 'string' ? p.session_id  : '';
  const toolUseId = typeof p.tool_use_id === 'string' ? p.tool_use_id : '';
  if (!sessionId || !toolUseId) process.exit(0);

  const ti = (p.tool_input && typeof p.tool_input === 'object') ? p.tool_input : {};
  const subagentType = typeof ti.subagent_type === 'string' ? ti.subagent_type : '';
  const description  = typeof ti.description   === 'string' ? ti.description   : '';
  const prompt       = typeof ti.prompt        === 'string' ? ti.prompt        : '';
  const cwd          = typeof p.cwd            === 'string' ? p.cwd            : '';
  const background   = ti.run_in_background === true;

  const started = lib.nowIsoZ();

  // Counter line — lean shape. `background` flag is omitted when false to keep
  // foreground entries byte-identical to the v0.9.x format.
  const counterEntry = {
    id: toolUseId,
    type: subagentType,
    desc: description,
    started,
    status: 'running',
  };
  if (background) counterEntry.background = true;
  lib.counterAppend(sessionId, counterEntry);

  // History entry — full-fat seed.
  lib.historyAppend({
    session_id: sessionId,
    tool_use_id: toolUseId,
    subagent_type: subagentType,
    description,
    prompt,
    started,
    ended: null,
    duration_ms: null,
    status: 'running',
    total_cost_usd: null,
    usage: null,
    cwd,
    background,
  });
} catch (_) { /* swallow any unexpected error */ }
process.exit(0);
