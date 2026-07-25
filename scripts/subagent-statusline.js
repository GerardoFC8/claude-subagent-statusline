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
// Shared with scripts/statusline.js so both clocks format identically.
const { formatDuration } = require('./lib/duration');
// Rendered-column measurement. String.length is the wrong ruler here: a CJK
// description under-reports and an emoji must not be cut mid-surrogate.
const { visibleWidth, truncateToWidth } = require('./lib/width');

// Task types Claude Code uses internally rather than to describe the agent. They
// are identical across every foreground sub-agent, so rendering them costs width
// and conveys nothing. Confirmed against a captured live payload: the requested
// agent type ("Explore", "general-purpose", …) is not exposed in any field.
const INTERNAL_TASK_TYPES = new Set(['local_agent']);

// Context-fill bar. Fixed width so the row never changes shape between ticks and
// each tick advances at most one cell — the finest step this many cells allows.
const BAR_FILLED = '█';
const BAR_EMPTY = '░';
const BAR_CELLS = 16;

// Compact token count. Scales through thousands and millions so a 1M context
// window reads "1M" rather than "1000k". The threshold test runs on the raw
// value, not the rounded one, so 999.6 stays under the "exact" branch.
function formatTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  if (n < 1000) return String(Math.floor(n));
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  const m = n / 1000000;
  // One decimal below 10M keeps 1.5M distinguishable from 1M without widening
  // the segment; above that the decimal is noise.
  return m < 10 ? `${Math.round(m * 10) / 10}M` : `${Math.round(m)}M`;
}

// Draw context usage as a fixed-width fill bar. Unlike a min/max-normalised
// trend, this is an absolute scale: two rows with the same bar have consumed the
// same share of their window, and the bar cannot exaggerate a small movement.
function contextBar(used, total) {
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return '';
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return '';
  const ratio = Math.min(1, used / total);
  let filled = Math.round(ratio * BAR_CELLS);
  // Any consumption at all shows at least one cell, so a busy sub-agent on a 1M
  // window is never indistinguishable from one that has consumed nothing.
  if (filled === 0 && used > 0) filled = 1;
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(BAR_CELLS - filled);
}

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
    const typeRaw = typeof t.type === 'string' ? t.type : typeof t.name === 'string' ? t.name : '';
    const type = INTERNAL_TASK_TYPES.has(typeRaw) ? '' : typeRaw;
    const desc = typeof t.description === 'string' ? t.description : '';

    // Effort level, rendered as `(high)` right after the model so these rows match
    // the main statusline, which has shown the active effort since v0.9.0. The
    // per-task payload sends a bare string; the `{ level }` object shape is accepted
    // too because that is how the main statusline payload carries it.
    const effortRaw = t.effort && typeof t.effort === 'object' ? t.effort.level : t.effort;
    const effort =
      typeof effortRaw === 'string' && effortRaw.trim() ? ` (${effortRaw.trim()})` : '';

    // Context usage: a fixed-width fill bar plus the absolute figure. Both need
    // tokenCount and contextWindowSize, so they appear and disappear together.
    const bar = contextBar(t.tokenCount, t.contextWindowSize);
    const usedTok = formatTokens(t.tokenCount);
    // A window of 0 is meaningless, and formatTokens(0) legitimately returns "0",
    // so the window needs its own positive check or the figure reads "5/0".
    const hasWindow =
      typeof t.contextWindowSize === 'number' &&
      Number.isFinite(t.contextWindowSize) &&
      t.contextWindowSize > 0;
    const totalTok = hasWindow ? formatTokens(t.contextWindowSize) : null;
    const usage = usedTok !== null && totalTok !== null ? `${usedTok}/${totalTok}` : '';

    // How long this sub-agent has been running. `startTime` is epoch milliseconds.
    const elapsed =
      typeof t.startTime === 'number' ? formatDuration((Date.now() - t.startTime) / 1000) : null;

    // Every width decision below is made on plain text and measured in rendered
    // columns, then colour is applied to whatever survived. Slicing an
    // already-coloured string would cut through an escape sequence and leave the
    // colour open for the rest of the line.
    const head = (model || '⋯') + effort;
    const keep = { type: !!type, bar: !!bar, usage: !!usage, elapsed: !!elapsed };

    const tailText = () => {
      let s = '';
      if (keep.bar) s += ` ${bar}`;
      if (keep.usage) s += ` ${usage}`;
      if (keep.elapsed) s += `${SEP}${elapsed}`;
      return s;
    };
    const rowWidth = (descText) =>
      visibleWidth(head) +
      (keep.type ? visibleWidth(SEP + type) : 0) +
      (descText ? visibleWidth(SEP + descText) : 0) +
      visibleWidth(tailText());

    // Give the description whatever the fixed pieces leave over.
    let descOut = '';
    const fitDescription = () => {
      const avail = columns - rowWidth('') - visibleWidth(SEP);
      descOut = avail > 1 ? truncateToWidth(desc, avail) : '';
    };
    fitDescription();

    // Truncating the description alone cannot honour `columns` once the fixed
    // pieces exceed it on their own, which happens on narrow panes. Shed optional
    // segments least-informative-first until the row fits.
    for (const segment of ['type', 'bar', 'elapsed', 'usage']) {
      if (rowWidth(descOut) <= columns) break;
      keep[segment] = false;
      fitDescription();
    }

    // Last resort: even the model alone does not fit.
    const headOut = rowWidth(descOut) > columns ? truncateToWidth(head, columns) : head;

    const modelSeg = model
      ? `${BOLD}${CYAN}${model}${RESET}${effort ? `${DIM}${effort}${RESET}` : ''}`
      : `${DIM}${headOut}${RESET}`;
    const segs = [headOut === head ? modelSeg : `${BOLD}${CYAN}${headOut}${RESET}`];
    if (keep.type) segs.push(`${DIM}${type}${RESET}`);
    if (descOut) segs.push(descOut);

    let content = segs.join(SEP);
    const tail = tailText();
    if (tail) content += `${DIM}${tail}${RESET}`;

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
