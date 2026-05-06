// tests/track-fail.test.js — REQ-HOOKS-106, REQ-HISTORY-108
// Slice 2: track-delegation-fail.js (PostToolUseFailure hook)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScript, readJsonl, counterFile, REPO_ROOT } = require('./_helpers');

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'track-delegation-fail.js');

// ---------------------------------------------------------------------------
// Helper: build a valid PostToolUseFailure payload
// ---------------------------------------------------------------------------
function makeFailPayload(overrides) {
  return Object.assign({
    session_id: 'sess-fail-' + Date.now(),
    tool_use_id: 'toolu_fail123',
  }, overrides);
}

// ---------------------------------------------------------------------------
// Helper: pre-create counter file to simulate pre-hook having fired
// ---------------------------------------------------------------------------
function createCounterFile(home, sessionId) {
  const dir = path.join(home, '.claude', 'state');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `delegations-${sessionId}.jsonl`);
  fs.writeFileSync(file,
    JSON.stringify({ id: 'toolu_fail123', status: 'running', started: new Date().toISOString() }) + '\n');
  return file;
}

// ---------------------------------------------------------------------------
// 2.4.1 — valid payload with counter file: counter + history both written
// ---------------------------------------------------------------------------
test('track-fail: valid payload writes failed entries to counter and history, exits 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-fail-'));
  const p = makeFailPayload({ session_id: 'fail-valid-' + Date.now() });
  createCounterFile(tmpDir, p.session_id);
  const { status } = runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0, 'must exit 0');

  // Counter: must have a failed line
  const cFile = counterFile(tmpDir, p.session_id);
  const cLines = readJsonl(cFile);
  const failedEntry = cLines.find(l => l.status === 'failed');
  assert.ok(failedEntry, 'counter must have a failed entry');
  assert.strictEqual(failedEntry.id, p.tool_use_id);
  assert.match(failedEntry.ended, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    'ended must be UTC Z format');

  // History: always written
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  assert.ok(fs.existsSync(hFile), 'history file must exist');
  const hLines = readJsonl(hFile);
  assert.strictEqual(hLines.length, 1, 'history must have 1 line');
  const hEntry = hLines[0];
  assert.strictEqual(hEntry.session_id, p.session_id);
  assert.strictEqual(hEntry.tool_use_id, p.tool_use_id);
  assert.strictEqual(hEntry.status, 'failed');
  assert.strictEqual(hEntry.total_cost_usd, null);
  assert.strictEqual(hEntry.duration_ms, null);
  assert.strictEqual(hEntry.usage, null);
  assert.match(hEntry.ended, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.4.3 — no counter file: counter not created, history still written
// ---------------------------------------------------------------------------
test('track-fail: no counter file — history written, counter NOT created', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-fail-'));
  const p = makeFailPayload({ session_id: 'fail-nocounter-' + Date.now() });
  // DO NOT create counter file
  const { status } = runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0, 'must exit 0');

  // Counter file must NOT be created
  const cFile = counterFile(tmpDir, p.session_id);
  assert.ok(!fs.existsSync(cFile), 'counter file must NOT be created when absent');

  // History must still be written
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  assert.ok(fs.existsSync(hFile), 'history file must be written even when counter absent');
  const hEntry = readJsonl(hFile)[0];
  assert.strictEqual(hEntry.status, 'failed');

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.4.5 — malformed stdin: exits 0 (REQ-HISTORY-108)
// ---------------------------------------------------------------------------
test('track-fail: malformed stdin exits 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-fail-'));
  const { status } = runScript(SCRIPT, '{bad json', {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0, 'must exit 0 on malformed stdin');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.4.7 — missing session_id: exits 0 without writing
// ---------------------------------------------------------------------------
test('track-fail: missing session_id exits 0 without writing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-fail-'));
  const p = makeFailPayload();
  delete p.session_id;
  const { status } = runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0);
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  assert.ok(!fs.existsSync(hFile), 'history must NOT be written when session_id missing');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});
