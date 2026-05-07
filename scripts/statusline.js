#!/usr/bin/env node
// scripts/statusline.js — entry point. MUST exit 0 in all paths.
'use strict';

const fs = require('fs');
const lib = require('./lib/history');

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
  const model = (typeof modelRaw === 'string' && modelRaw.length > 0) ? modelRaw : '?';
  let pct = parsed && parsed.context_window && parsed.context_window.used_percentage;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    const n = Number(pct);
    pct = Number.isFinite(n) ? n : 0;
  }
  let pctInt = Math.round(pct);
  if (pctInt < 0) pctInt = 0;
  if (pctInt > 100) pctInt = 100;

  const RESET = '\x1b[0m';
  let color;
  if (pctInt < 50) color = '\x1b[32m';
  else if (pctInt < 80) color = '\x1b[33m';
  else color = '\x1b[31m';

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

  let elapsedSeg = '';
  if (baselineSec !== null) {
    let secs = lib.nowEpochSeconds() - baselineSec;
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

  const out =
    `[${model}${costSuffix}] ${color}${bar}${RESET} ${pctInt}% │ ⚡ ${counters.running} running | ✓ ${counters.done} done${failedSeg}${elapsedSeg}`;

  process.stdout.write(out + '\n');
  process.exit(0);
}
