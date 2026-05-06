#!/usr/bin/env node
// scripts/track-delegation-fail.js — PostToolUseFailure hook.
// Appends a "failed" entry to the per-session counter file (ONLY if it exists)
// AND a failed entry to the global history file (ALWAYS written).
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

  const ended = lib.nowIsoZ();

  // Counter line ONLY if per-session file already exists (bash parity).
  let counterReadable = false;
  try { fs.accessSync(lib.counterPath(sessionId), fs.constants.R_OK); counterReadable = true; } catch (_) {}
  if (counterReadable) {
    lib.counterAppend(sessionId, { id: toolUseId, ended, status: 'failed' });
  }

  // History entry: ALWAYS written (failure recorded globally even if pre never fired).
  lib.historyAppend({
    session_id: sessionId,
    tool_use_id: toolUseId,
    ended,
    duration_ms: null,
    status: 'failed',
    total_cost_usd: null,
    usage: null,
  });
} catch (_) { /* swallow any unexpected error */ }
process.exit(0);
