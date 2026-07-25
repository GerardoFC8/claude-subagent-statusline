#!/usr/bin/env node
// scripts/subagent-statusline.js — per-subagent statusline renderer. MUST exit 0 in all paths.
// Consumes Claude Code's `subagentStatusLine` contract: reads a single JSON
// object on stdin ({ ...baseFields, columns, tasks[] }) and writes one
// {"id","content"} JSON line per row to stdout — one row per running sub-agent,
// each leading with the RESOLVED model it runs on ("Opus 4.8", "Haiku 4.5", …).
// Requires Claude Code v2.1.205+ for the per-task `model` field. Older Claude Code
// versions simply ignore the setting, so registering the command is always safe.
'use strict';

const fs = require('fs');
// Shared with scripts/statusline.js. Returns null for unrecognised ids, which is
// what drives the dim ⋯ fallback below — the per-task payload has no display_name.
const { parseModelFromId } = require('./lib/model');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function main() {
  const data = JSON.parse(readStdin());
  if (!data || !Array.isArray(data.tasks)) return;

  const columns = Number.isInteger(data.columns) && data.columns > 0 ? data.columns : 80;
  const SEP = ' · ';
  const out = [];

  for (const t of data.tasks) {
    if (!t || typeof t.id !== 'string') continue;

    const model = parseModelFromId(t.model);
    const type = typeof t.type === 'string' ? t.type : typeof t.name === 'string' ? t.name : '';
    const desc = typeof t.description === 'string' ? t.description : '';

    // Effort level, rendered as `(high)` right after the model so these rows match
    // the main statusline, which has shown the active effort since v0.9.0. The
    // per-task payload sends a bare string; the `{ level }` object shape is accepted
    // too because that is how the main statusline payload carries it.
    const effortRaw = t.effort && typeof t.effort === 'object' ? t.effort.level : t.effort;
    const effort =
      typeof effortRaw === 'string' && effortRaw.trim() ? ` (${effortRaw.trim()})` : '';

    let ctx = '';
    if (
      typeof t.tokenCount === 'number' &&
      typeof t.contextWindowSize === 'number' &&
      t.contextWindowSize > 0
    ) {
      ctx = ` ${Math.round((t.tokenCount / t.contextWindowSize) * 100)}%`;
    }

    // Budget the description against the visible (ANSI-free) width so the row
    // never overflows the terminal. `⋯` is the zero-model fallback width.
    const modelPlain = model || '⋯';
    const fixed =
      modelPlain.length + effort.length + (type ? SEP.length + type.length : 0) + ctx.length;
    const descBudget = columns - fixed - SEP.length - 2;
    let descOut = desc;
    if (descBudget <= 1) descOut = '';
    else if (desc.length > descBudget) descOut = desc.slice(0, descBudget - 1) + '…';

    const modelSeg = model
      ? `${BOLD}${CYAN}${model}${RESET}${effort ? `${DIM}${effort}${RESET}` : ''}`
      : `${DIM}⋯${effort}${RESET}`;
    const segs = [modelSeg];
    if (type) segs.push(`${DIM}${type}${RESET}`);
    if (descOut) segs.push(descOut);

    let content = segs.join(SEP);
    if (ctx) content += `${DIM}${ctx}${RESET}`;

    out.push(JSON.stringify({ id: t.id, content }));
  }

  if (out.length) process.stdout.write(out.join('\n') + '\n');
}

try {
  main();
} catch (_) {
  // Any malformed input or unexpected error: emit nothing and leave Claude Code's
  // default per-subagent rendering in place.
}
process.exit(0);
