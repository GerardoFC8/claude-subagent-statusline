// tests/subagent-statusline.test.js — per-subagent statusline renderer
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, runScript } = require('./_helpers');

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'subagent-statusline.js');

// Strip ANSI escapes so we can assert on the visible text.
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// Parse stdout into an array of {id, content} objects (one JSON object per line).
function rows(stdout) {
  return stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// exit-0 / empty-output contract
// ---------------------------------------------------------------------------

test('subagent-statusline: script exists and exits 0 with empty stdin, no output', () => {
  assert.ok(fs.existsSync(SCRIPT), 'subagent-statusline.js must exist');
  const r = runScript(SCRIPT, '');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '', 'empty stdin must produce no rows');
});

test('subagent-statusline: malformed JSON stdin exits 0 with no output', () => {
  const r = runScript(SCRIPT, '{ not json ');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('subagent-statusline: missing/non-array tasks exits 0 with no output', () => {
  assert.strictEqual(runScript(SCRIPT, JSON.stringify({ columns: 80 })).stdout, '');
  assert.strictEqual(runScript(SCRIPT, JSON.stringify({ tasks: 'nope' })).stdout, '');
  assert.strictEqual(runScript(SCRIPT, JSON.stringify({ tasks: {} })).stdout, '');
  assert.strictEqual(runScript(SCRIPT, JSON.stringify({ tasks: [] })).stdout, '');
});

// ---------------------------------------------------------------------------
// model resolution across id formats
// ---------------------------------------------------------------------------

test('subagent-statusline: resolves model names across id formats', () => {
  const payload = {
    columns: 200,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8[1m]' },
      { id: 'b', model: 'claude-sonnet-5' },
      { id: 'c', model: 'claude-haiku-4-5-20251001' },
      { id: 'd', model: 'claude-fable-5' },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  assert.strictEqual(r.status, 0);
  const out = rows(r.stdout);
  assert.strictEqual(out.length, 4);
  assert.ok(plain(out[0].content).startsWith('Opus 4.8'), plain(out[0].content));
  assert.ok(plain(out[1].content).startsWith('Sonnet 5'), plain(out[1].content));
  assert.ok(plain(out[2].content).startsWith('Haiku 4.5'), plain(out[2].content));
  assert.ok(plain(out[3].content).startsWith('Fable 5'), plain(out[3].content));
});

test('subagent-statusline: unresolved/empty model falls back to ⋯', () => {
  const payload = {
    columns: 80,
    tasks: [
      { id: 'a' }, // no model
      { id: 'b', model: '' }, // empty string
      { id: 'c', model: 42 }, // non-string
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const out = rows(r.stdout);
  assert.strictEqual(out.length, 3);
  for (const row of out) {
    assert.ok(plain(row.content).startsWith('⋯'), `expected ⋯ fallback, got: ${plain(row.content)}`);
  }
});

test('subagent-statusline: degenerate id with zero usable parts falls back to ⋯', () => {
  // Ids that parse down to nothing (e.g. "claude-") must render the ⋯ fallback,
  // not echo the raw, meaningless id string.
  const payload = {
    columns: 80,
    tasks: [
      { id: 'a', model: 'claude-' },
      { id: 'b', model: 'claude-[1m]' },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const out = rows(r.stdout);
  assert.strictEqual(out.length, 2);
  for (const row of out) {
    const visible = plain(row.content);
    assert.ok(visible.startsWith('⋯'), `expected ⋯ fallback, got: ${visible}`);
    assert.ok(!visible.includes('claude-'), `must not echo raw id, got: ${visible}`);
  }
});

// ---------------------------------------------------------------------------
// per-row {id, content} output shape
// ---------------------------------------------------------------------------

test('subagent-statusline: emits one {id,content} line per task, echoing task id', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'task-1', model: 'claude-opus-4-8', type: 'explore', description: 'map the repo' },
      { id: 'task-2', model: 'claude-haiku-4-5', name: 'writer', description: 'draft docs' },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const out = rows(r.stdout);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].id, 'task-1');
  assert.strictEqual(out[1].id, 'task-2');
  assert.ok(typeof out[0].content === 'string' && out[0].content.length > 0);
  // `type` falls back to `name` when `type` is absent.
  assert.ok(plain(out[1].content).includes('writer'));
  assert.ok(plain(out[0].content).includes('explore'));
});

test('subagent-statusline: tasks with a non-string id are skipped', () => {
  const payload = {
    columns: 80,
    tasks: [
      { id: 123, model: 'claude-opus-4-8' }, // skipped
      { model: 'claude-opus-4-8' }, // no id → skipped
      { id: 'ok', model: 'claude-sonnet-5' },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const out = rows(r.stdout);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'ok');
});

// ---------------------------------------------------------------------------
// description truncation against `columns`
// ---------------------------------------------------------------------------

test('subagent-statusline: long description is truncated to fit columns and ends with …', () => {
  const columns = 40;
  const payload = {
    columns,
    tasks: [{ id: 'a', model: 'claude-opus-4-8', type: 'general', description: 'x'.repeat(200) }],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const out = rows(r.stdout);
  const visible = plain(out[0].content);
  assert.ok(visible.length <= columns, `visible width ${visible.length} must be <= ${columns}`);
  assert.ok(visible.endsWith('…'), `truncated row must end with …: ${visible}`);
});

test('subagent-statusline: description is dropped entirely when the budget is tiny', () => {
  const payload = {
    columns: 12, // barely enough for model + type, no room for description
    tasks: [{ id: 'a', model: 'claude-opus-4-8', type: 'general', description: 'should vanish' }],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const out = rows(r.stdout);
  assert.ok(!plain(out[0].content).includes('should vanish'));
});

// ---------------------------------------------------------------------------
// context-window percentage
// ---------------------------------------------------------------------------

test('subagent-statusline: appends context percentage when token counts are present', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 50000, contextWindowSize: 200000 },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const visible = plain(rows(r.stdout)[0].content);
  assert.ok(visible.includes('25%'), `expected 25% context, got: ${visible}`);
});

test('subagent-statusline: no percentage when contextWindowSize is zero or missing', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 5, contextWindowSize: 0 },
      { id: 'b', model: 'claude-opus-4-8', tokenCount: 5 },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  for (const row of rows(r.stdout)) {
    assert.ok(!/\d%/.test(plain(row.content)), `unexpected percentage: ${plain(row.content)}`);
  }
});

test('subagent-statusline: defaults to 80 columns when columns is absent or invalid', () => {
  const payload = {
    tasks: [{ id: 'a', model: 'claude-opus-4-8', type: 'general', description: 'y'.repeat(300) }],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const visible = plain(rows(r.stdout)[0].content);
  assert.ok(visible.length <= 80, `must fit default 80 columns: got ${visible.length}`);
  assert.ok(visible.endsWith('…'));
});
