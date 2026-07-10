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

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';

// Resolve a raw model id to a compact, human-readable label. Mirrors the parsing
// used by scripts/statusline.js for the main model, but tolerates the wider set
// of id shapes Claude Code emits for sub-agents:
//   claude-opus-4-8[1m]          → "Opus 4.8"
//   claude-sonnet-5              → "Sonnet 5"
//   claude-haiku-4-5-20251001    → "Haiku 4.5"
//   claude-fable-5               → "Fable 5"
// Returns null for empty/non-string ids so the caller can render the ⋯ fallback.
function prettyModel(id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  let s = id.trim().replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').trim();
  const at = s.lastIndexOf('claude-');
  if (at >= 0) s = s.slice(at);
  s = s.replace(/^claude-/, '').replace(/-\d{8}$/, '').split(/[:@]/)[0];
  const parts = s.split('-').filter(Boolean);
  // Id parsed down to zero usable parts (e.g. "claude-"): return null so the
  // caller renders the dim ⋯ fallback rather than echoing a meaningless raw id.
  if (!parts.length) return null;
  const family = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const version = parts.slice(1).join('.');
  return version ? `${family} ${version}` : family;
}

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

    const model = prettyModel(t.model);
    const type = typeof t.type === 'string' ? t.type : typeof t.name === 'string' ? t.name : '';
    const desc = typeof t.description === 'string' ? t.description : '';

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
    const fixed = modelPlain.length + (type ? SEP.length + type.length : 0) + ctx.length;
    const descBudget = columns - fixed - SEP.length - 2;
    let descOut = desc;
    if (descBudget <= 1) descOut = '';
    else if (desc.length > descBudget) descOut = desc.slice(0, descBudget - 1) + '…';

    const modelSeg = model ? `${BOLD}${CYAN}${model}${RESET}` : `${DIM}⋯${RESET}`;
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
