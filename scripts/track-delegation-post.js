#!/usr/bin/env node
// scripts/track-delegation-post.js — PostToolUse hook.
// Appends a lean "done" entry to the per-session JSONL counter file (if it exists)
// AND a finalization entry (with metrics) to the global history file.
// Exit 0 in ALL paths (REQ-HISTORY-108).
// Note: if counter file is missing (pre-hook never fired), exits early before
// writing history — matching bash post.sh behavior exactly.
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

  // Missing-file tolerance (REQ-HOOKS-105): if counter file doesn't exist,
  // exit before writing anything (mirrors bash: [[ -r "$state_file" ]] || exit 0).
  const counterFilePath = lib.counterPath(sessionId);
  let counterReadable = false;
  try { fs.accessSync(counterFilePath, fs.constants.R_OK); counterReadable = true; } catch (_) {}
  if (!counterReadable) process.exit(0);

  const tr = (p.tool_response && typeof p.tool_response === 'object') ? p.tool_response : {};

  // Background-agent launches return `tool_response.status === "async_launched"` with
  // `agentId` and a near-zero duration_ms. The actual sub-agent runs after the hook
  // returns; its real completion comes through SubagentStop. So we record the
  // agent_id ↔ tool_use_id mapping and DO NOT close the entry.
  if (tr.status === 'async_launched') {
    const agentId = typeof tr.agentId === 'string' ? tr.agentId : '';
    if (agentId) {
      lib.counterAppend(sessionId, {
        id: toolUseId,
        agent_id: agentId,
        status: 'bg_launched',
      });
      lib.historyAppend({
        session_id: sessionId,
        tool_use_id: toolUseId,
        agent_id: agentId,
        status: 'bg_launched',
        launched_at: lib.nowIsoZ(),
      });
    }
    process.exit(0);
  }

  const usage = (tr.usage && typeof tr.usage === 'object') ? tr.usage : {};

  // numOrNull: returns value if finite number, else null.
  const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

  const duration_ms                  = numOrNull(p.duration_ms);
  const total_cost_usd               = numOrNull(tr.total_cost_usd);
  const input_tokens                 = numOrNull(usage.input_tokens);
  const output_tokens                = numOrNull(usage.output_tokens);
  const cache_read_input_tokens      = numOrNull(usage.cache_read_input_tokens);
  const cache_creation_input_tokens  = numOrNull(usage.cache_creation_input_tokens);
  const total_tool_use_count         = numOrNull(tr.totalToolUseCount);

  // Response text from tool_response.content[0].text, truncated at 16384 chars.
  let response = null;
  const content = Array.isArray(tr.content) ? tr.content : null;
  const first = content && content[0];
  const text = first && typeof first.text === 'string' ? first.text : '';
  if (text.length > 0) {
    if (text.length > 16384) {
      response = text.slice(0, 16384) + ' …(truncated)';
    } else {
      response = text;
    }
  }

  const ended = lib.nowIsoZ();

  // Counter line — lean done shape.
  lib.counterAppend(sessionId, { id: toolUseId, ended, status: 'done' });

  // Usage object: null when all 4 token fields are null.
  const usageObj = (input_tokens === null && output_tokens === null
    && cache_read_input_tokens === null && cache_creation_input_tokens === null)
    ? null
    : { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens };

  // History finalization entry.
  lib.historyAppend({
    session_id: sessionId,
    tool_use_id: toolUseId,
    ended,
    duration_ms,
    status: 'done',
    total_cost_usd,
    total_tool_use_count,
    usage: usageObj,
    response,
  });
} catch (_) { /* swallow any unexpected error */ }
process.exit(0);
