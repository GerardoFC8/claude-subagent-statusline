// tests/track-post.test.js — REQ-HOOKS-105, REQ-HISTORY-108
// Slice 2: track-delegation-post.js (PostToolUse hook)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScript, readJsonl, counterFile, REPO_ROOT } = require('./_helpers');

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'track-delegation-post.js');

// ---------------------------------------------------------------------------
// Helper: build a valid PostToolUse payload
// ---------------------------------------------------------------------------
function makePostPayload(overrides) {
  return Object.assign({
    session_id: 'sess-post-' + Date.now(),
    tool_use_id: 'toolu_post123',
    duration_ms: 5432,
    tool_response: {
      total_cost_usd: 0.0042,
      totalToolUseCount: 3,
      usage: {
        input_tokens: 800,
        output_tokens: 200,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
      },
      content: [{ type: 'text', text: 'All checks passed.' }],
    },
  }, overrides);
}

// ---------------------------------------------------------------------------
// Helper: pre-create counter file to simulate pre-hook having fired
// ---------------------------------------------------------------------------
function createCounterFile(home, sessionId) {
  const dir = path.join(home, '.claude', 'state');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `delegations-${sessionId}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ id: 'toolu_post123', status: 'running', started: new Date().toISOString() }) + '\n');
  return file;
}

// ---------------------------------------------------------------------------
// 2.3.1 — valid payload: counter and history lines written, exits 0
// ---------------------------------------------------------------------------
test('track-post: valid payload writes done entries to counter and history, exits 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-post-'));
  const p = makePostPayload({ session_id: 'post-valid-' + Date.now() });
  createCounterFile(tmpDir, p.session_id);
  const { status } = runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0, 'must exit 0');

  // Counter file: must have a new 'done' line
  const cFile = counterFile(tmpDir, p.session_id);
  const cLines = readJsonl(cFile);
  const doneEntry = cLines.find(l => l.status === 'done');
  assert.ok(doneEntry, 'counter must have a done entry');
  assert.strictEqual(doneEntry.id, p.tool_use_id);
  assert.match(doneEntry.ended, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  // History file: must have a done entry with metrics
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  assert.ok(fs.existsSync(hFile), 'history file must exist');
  const hLines = readJsonl(hFile);
  assert.strictEqual(hLines.length, 1, 'history must have 1 line');
  const hEntry = hLines[0];
  assert.strictEqual(hEntry.session_id, p.session_id);
  assert.strictEqual(hEntry.tool_use_id, p.tool_use_id);
  assert.strictEqual(hEntry.status, 'done');
  assert.strictEqual(hEntry.total_cost_usd, 0.0042);
  assert.strictEqual(hEntry.duration_ms, 5432);
  assert.strictEqual(hEntry.total_tool_use_count, 3);
  assert.deepStrictEqual(hEntry.usage, {
    input_tokens: 800,
    output_tokens: 200,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 50,
  });
  assert.strictEqual(hEntry.response, 'All checks passed.');
  assert.match(hEntry.ended, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.3.3 — missing counter file: exits 0, no new file created (REQ-HOOKS-105)
// ---------------------------------------------------------------------------
test('track-post: missing counter file exits 0, no file created', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-post-'));
  const p = makePostPayload({ session_id: 'post-ghost-' + Date.now() });
  // DO NOT create counter file
  const { status } = runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0, 'must exit 0 when counter file missing');
  const cFile = counterFile(tmpDir, p.session_id);
  assert.ok(!fs.existsSync(cFile), 'counter file must NOT be created');
  // Per design note: post.sh exits before history if counter missing. Node mirrors this.
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  assert.ok(!fs.existsSync(hFile), 'history file must NOT be created when counter file missing');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.3.5 — missing session_id: exits 0 without writing
// ---------------------------------------------------------------------------
test('track-post: missing session_id exits 0 without writing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-post-'));
  const p = makePostPayload();
  delete p.session_id;
  const { status } = runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.3.7 — malformed stdin: exits 0 (REQ-HISTORY-108)
// ---------------------------------------------------------------------------
test('track-post: malformed stdin exits 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-post-'));
  const { status } = runScript(SCRIPT, '{bad json', {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0, 'must exit 0 on malformed stdin');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.3.9 — null usage when all 4 token fields absent
// ---------------------------------------------------------------------------
test('track-post: usage is null when all 4 token fields absent', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-post-'));
  const p = makePostPayload({ session_id: 'post-nullusage-' + Date.now() });
  p.tool_response = { total_cost_usd: 0.001 }; // no usage, no content
  createCounterFile(tmpDir, p.session_id);
  runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  const hEntry = readJsonl(hFile)[0];
  assert.strictEqual(hEntry.usage, null, 'usage must be null when no token fields');
  assert.strictEqual(hEntry.response, null, 'response must be null when content absent');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.3.11 — response truncation at 16384 characters
// ---------------------------------------------------------------------------
test('track-post: response is truncated at 16384 chars with ellipsis marker', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-post-'));
  const p = makePostPayload({ session_id: 'post-trunc-' + Date.now() });
  const longText = 'x'.repeat(20000);
  p.tool_response = {
    content: [{ type: 'text', text: longText }],
  };
  createCounterFile(tmpDir, p.session_id);
  runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  const hEntry = readJsonl(hFile)[0];
  assert.ok(typeof hEntry.response === 'string', 'response must be string');
  assert.ok(hEntry.response.length <= 16384 + ' …(truncated)'.length,
    'response must be at most 16384 + ellipsis chars');
  assert.ok(hEntry.response.endsWith(' …(truncated)'), 'must end with truncation marker');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// 2.3.13 — numeric fields are null when missing from payload
// ---------------------------------------------------------------------------
test('track-post: numeric fields default to null when absent', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-post-'));
  const p = makePostPayload({ session_id: 'post-nullnums-' + Date.now() });
  p.tool_response = {}; // no metrics
  delete p.duration_ms;
  createCounterFile(tmpDir, p.session_id);
  runScript(SCRIPT, JSON.stringify(p), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  const hEntry = readJsonl(hFile)[0];
  assert.strictEqual(hEntry.duration_ms, null, 'duration_ms must be null');
  assert.strictEqual(hEntry.total_cost_usd, null, 'total_cost_usd must be null');
  assert.strictEqual(hEntry.total_tool_use_count, null, 'total_tool_use_count must be null');
  assert.strictEqual(hEntry.usage, null, 'usage must be null');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});
