// tests/track-pre.test.js — REQ-HOOKS-104, REQ-HISTORY-108
// Slice 2: track-delegation-pre.js (PreToolUse hook)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScript, readJsonl, counterFile, REPO_ROOT } = require('./_helpers');

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'track-delegation-pre.js');

// ---------------------------------------------------------------------------
// Helper: build a valid PreToolUse payload
// ---------------------------------------------------------------------------
function makePrePayload(overrides) {
  return Object.assign({
    session_id: 'sess-pre-' + Date.now(),
    tool_use_id: 'toolu_abc123',
    tool_input: {
      subagent_type: 'general-purpose',
      description: 'Run a build check',
      prompt: 'Check the build and report any errors.',
    },
    cwd: '/workspace/myproject',
  }, overrides);
}

// ---------------------------------------------------------------------------
// 2.2.1 — valid payload: counter and history lines written, exit 0
// ---------------------------------------------------------------------------
test('track-pre: valid payload writes counter and history lines, exits 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-pre-'));
  const p = makePrePayload({ session_id: 'pre-valid-' + Date.now() });
  const { status } = runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0, 'must exit 0');
  // Counter file
  const cFile = counterFile(tmpDir, p.session_id);
  assert.ok(fs.existsSync(cFile), 'counter file must exist');
  const cLines = readJsonl(cFile);
  assert.strictEqual(cLines.length, 1, 'counter must have 1 line');
  const cEntry = cLines[0];
  assert.strictEqual(cEntry.id, p.tool_use_id);
  assert.strictEqual(cEntry.status, 'running');
  assert.strictEqual(cEntry.type, p.tool_input.subagent_type);
  assert.strictEqual(cEntry.desc, p.tool_input.description);
  assert.match(cEntry.started, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'started must be Z format');
  // History file
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  assert.ok(fs.existsSync(hFile), 'history file must exist');
  const hLines = readJsonl(hFile);
  assert.strictEqual(hLines.length, 1, 'history must have 1 line');
  const hEntry = hLines[0];
  assert.strictEqual(hEntry.session_id, p.session_id);
  assert.strictEqual(hEntry.tool_use_id, p.tool_use_id);
  assert.strictEqual(hEntry.subagent_type, p.tool_input.subagent_type);
  assert.strictEqual(hEntry.description, p.tool_input.description);
  assert.strictEqual(hEntry.prompt, p.tool_input.prompt);
  assert.strictEqual(hEntry.cwd, p.cwd);
  assert.strictEqual(hEntry.status, 'running');
  assert.strictEqual(hEntry.ended, null);
  assert.strictEqual(hEntry.duration_ms, null);
  assert.strictEqual(hEntry.total_cost_usd, null);
  assert.strictEqual(hEntry.usage, null);
  assert.match(hEntry.started, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.2.3 — missing session_id: exits 0, no file written
// ---------------------------------------------------------------------------
test('track-pre: missing session_id exits 0 without writing files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-pre-'));
  const p = makePrePayload({ session_id: undefined });
  delete p.session_id;
  const { status } = runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0);
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  assert.ok(!fs.existsSync(hFile), 'history file must NOT be created');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.2.5 — missing tool_use_id: exits 0, no file written
// ---------------------------------------------------------------------------
test('track-pre: missing tool_use_id exits 0 without writing files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-pre-'));
  const p = makePrePayload({ tool_use_id: undefined });
  delete p.tool_use_id;
  const { status } = runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0);
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  assert.ok(!fs.existsSync(hFile), 'history file must NOT be created');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.2.7 — malformed stdin: exits 0, no file written (REQ-HISTORY-108)
// ---------------------------------------------------------------------------
test('track-pre: malformed stdin exits 0, no file written', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-pre-'));
  const { status } = runScript(SCRIPT, '{invalid json', {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0, 'must exit 0 on malformed stdin');
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  assert.ok(!fs.existsSync(hFile), 'history file must NOT be created');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.2.9 — empty stdin: exits 0 (REQ-HISTORY-108)
// ---------------------------------------------------------------------------
test('track-pre: empty stdin exits 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-pre-'));
  const { status } = runScript(SCRIPT, '', {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0, 'must exit 0 on empty stdin');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.2.11 — missing optional fields (subagent_type): type defaults to empty string
// ---------------------------------------------------------------------------
test('track-pre: missing tool_input.subagent_type defaults to empty string', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-pre-'));
  const p = makePrePayload({ session_id: 'pre-notype-' + Date.now() });
  p.tool_input = {};  // remove all tool_input fields
  const { status } = runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0);
  const cFile = counterFile(tmpDir, p.session_id);
  assert.ok(fs.existsSync(cFile), 'counter file must exist');
  const cEntry = readJsonl(cFile)[0];
  assert.strictEqual(cEntry.type, '', 'type must be empty string when absent');
  assert.strictEqual(cEntry.desc, '', 'desc must be empty string when absent');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.2.13 — timestamps: both counter and history use UTC Z format
// ---------------------------------------------------------------------------
test('track-pre: timestamps in counter and history entries are UTC Z format', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-pre-'));
  const p = makePrePayload({ session_id: 'pre-ts-' + Date.now() });
  runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  const cEntry = readJsonl(counterFile(tmpDir, p.session_id))[0];
  const hEntry = readJsonl(path.join(tmpDir, 'histdata', 'history.jsonl'))[0];
  const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  assert.match(cEntry.started, ISO_Z, 'counter started must be Z format');
  assert.match(hEntry.started, ISO_Z, 'history started must be Z format');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// run_in_background flag — captured into the background field on entries
// ---------------------------------------------------------------------------
test('track-pre: run_in_background:true writes background:true on counter entry', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-pre-'));
  const p = makePrePayload({ session_id: 'pre-bg-' + Date.now() });
  p.tool_input.run_in_background = true;
  runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  const cEntry = readJsonl(counterFile(tmpDir, p.session_id))[0];
  const hEntry = readJsonl(path.join(tmpDir, 'histdata', 'history.jsonl'))[0];
  assert.strictEqual(cEntry.background, true, 'counter entry must mark background:true');
  assert.strictEqual(hEntry.background, true, 'history entry must mark background:true');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('track-pre: foreground (no run_in_background) omits background key from counter', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-pre-'));
  const p = makePrePayload({ session_id: 'pre-fg-' + Date.now() });
  // tool_input.run_in_background is intentionally not set
  runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  const cEntry = readJsonl(counterFile(tmpDir, p.session_id))[0];
  const hEntry = readJsonl(path.join(tmpDir, 'histdata', 'history.jsonl'))[0];
  assert.ok(!('background' in cEntry), 'counter entry must NOT have background key in foreground case');
  assert.strictEqual(hEntry.background, false, 'history entry must mark background:false explicitly');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});
