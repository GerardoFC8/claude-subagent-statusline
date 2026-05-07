#!/usr/bin/env node
// scripts/statusline.js — entry point. MUST exit 0 in all paths.
'use strict';

const fs = require('fs');
const lib = require('./lib/history');

const RESET = '\x1b[0m';

function colorForPct(p) {
  if (p < 50) return '\x1b[32m';
  if (p < 80) return '\x1b[33m';
  return '\x1b[31m';
}

function clampPct(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    const x = Number(n);
    n = Number.isFinite(x) ? x : 0;
  }
  let i = Math.round(n);
  if (i < 0) i = 0;
  if (i > 100) i = 100;
  return i;
}

function formatResetDelta(secs) {
  if (secs < 0) secs = 0;
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

function buildRateLimit(label, rl, nowSec) {
  if (!rl) return '';
  const pctVal = rl.used_percentage;
  if (typeof pctVal !== 'number' || !Number.isFinite(pctVal)) return '';
  const pInt = clampPct(pctVal);
  const c = colorForPct(pInt);

  let resetStr = '';
  const resetsAt = rl.resets_at;
  if (typeof resetsAt === 'number' && Number.isFinite(resetsAt)) {
    const delta = resetsAt - nowSec;
    if (delta > 0) resetStr = ` (reset en ${formatResetDelta(delta)})`;
  }
  return `${label}: ${c}${pInt}%${RESET}${resetStr}`;
}

try {
  main();
} catch (_) {
  // Belt-and-suspenders: any uncaught throw still produces a valid exit 0.
  // Output a fallback line so the statusline is never blank.
  try {
    process.stdout.write('[?] \x1b[32m░░░░░░░░░░\x1b[0m 0% │ ⚡ 0 running | ✓ 0 done │ ✗ 0 failed\n');
  } catch (_) {}
  process.exit(0);
}

function main() {
  let payload = '';
  try { payload = fs.readFileSync(0, 'utf8'); } catch (_) { payload = ''; }

  let parsed = null;
  try { parsed = JSON.parse(payload); } catch (_) { parsed = null; }

  const sessionId = parsed && parsed.session_id ? String(parsed.session_id) : '';
  const modelRaw = parsed && parsed.model && parsed.model.display_name;
  let model = (typeof modelRaw === 'string' && modelRaw.length > 0) ? modelRaw : '?';
  // Strip trailing "(...context...)" annotation (e.g. "(1M context)") so the bracket stays compact.
  model = model.replace(/\s*\([^)]*context[^)]*\)\s*$/i, '').trim() || '?';

  const pct = parsed && parsed.context_window && parsed.context_window.used_percentage;
  const pctInt = clampPct(pct);
  const color = colorForPct(pctInt);

  let filled = Math.floor(pctInt / 10);
  if (filled > 10) filled = 10;
  if (filled < 0) filled = 0;
  const empty = 10 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  // Persist session-start file on first sight of this session_id.
  let sessionStartFile = '';
  if (sessionId) {
    sessionStartFile = lib.sessionStartPath(sessionId);
    try {
      if (!fs.existsSync(sessionStartFile)) {
        lib.atomicWrite(sessionStartFile, String(lib.nowEpochSeconds()));
      }
    } catch (_) { /* swallow */ }
  }

  const counters = lib.readCounters(sessionId);

  // Elapsed baseline:
  //   1. epoch from oldestStarted (parsed via Date) — JSONL takes priority
  //   2. epoch from session-start file
  let baselineSec = null;
  if (counters.oldestStarted) {
    baselineSec = lib.isoToEpochSeconds(counters.oldestStarted);
  }
  if (baselineSec === null && sessionStartFile) {
    try {
      const txt = fs.readFileSync(sessionStartFile, 'utf8').trim();
      const n = parseInt(txt, 10);
      if (Number.isFinite(n)) baselineSec = n;
    } catch (_) { /* leave null */ }
  }

  const nowSec = lib.nowEpochSeconds();
  let elapsedSeg = '';
  if (baselineSec !== null) {
    let secs = nowSec - baselineSec;
    if (secs < 0) secs = 0;
    let fmt;
    if (secs < 60) {
      fmt = `${secs}s`;
    } else if (secs < 3600) {
      fmt = `${Math.floor(secs / 60)}m ${secs % 60}s`;
    } else {
      fmt = `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
    }
    elapsedSeg = ` │ ⏱ ${fmt}`;
  }

  const failedSeg = ` │ ✗ ${counters.failed} failed`;

  let costSuffix = '';
  const costRaw = parsed && parsed.cost && parsed.cost.total_cost_usd;
  if (typeof costRaw === 'number' && Number.isFinite(costRaw) && costRaw >= 0) {
    costSuffix = ` · $${costRaw.toFixed(2)}`;
  }

  // Rate limit segments — 5h window and 7d (Semana). Joined as one segment with `·` separator.
  const rl = parsed && parsed.rate_limits;
  const rl5h = rl ? buildRateLimit('Ventana 5h', rl.five_hour, nowSec) : '';
  const rl7d = rl ? buildRateLimit('Semana', rl.seven_day, nowSec) : '';
  let rateLimitSeg = '';
  if (rl5h && rl7d) rateLimitSeg = ` │ ${rl5h} · ${rl7d}`;
  else if (rl5h) rateLimitSeg = ` │ ${rl5h}`;
  else if (rl7d) rateLimitSeg = ` │ ${rl7d}`;

  const out =
    `[${model}${costSuffix}] ${color}${bar}${RESET} ${pctInt}%${elapsedSeg} │ ⚡ ${counters.running} running | ✓ ${counters.done} done${failedSeg}${rateLimitSeg}`;

  process.stdout.write(out + '\n');
  process.exit(0);
}
