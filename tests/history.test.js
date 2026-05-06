// tests/history.test.js — read-side (slice 1)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mkTmpHome, cleanupTmpHome } = require('./_helpers');

// ---------------------------------------------------------------------------
// 1.2.1 — require does not throw
// ---------------------------------------------------------------------------
test('history: require does not throw', () => {
  assert.doesNotThrow(() => require('../scripts/lib/history'));
});

// ---------------------------------------------------------------------------
// 1.2.3 / 1.2.5 — historyPath() resolution
// ---------------------------------------------------------------------------
test('history: historyPath() resolves from CLAUDE_PLUGIN_DATA env var', () => {
  const lib = require('../scripts/lib/history');
  const original = process.env.CLAUDE_PLUGIN_DATA;
  try {
    process.env.CLAUDE_PLUGIN_DATA = '/custom/path';
    const result = lib.historyPath();
    assert.strictEqual(result, path.join('/custom/path', 'history.jsonl'));
  } finally {
    if (original === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = original;
  }
});

test('history: historyPath() falls back to os.homedir() when env not set', () => {
  const lib = require('../scripts/lib/history');
  const original = process.env.CLAUDE_PLUGIN_DATA;
  try {
    delete process.env.CLAUDE_PLUGIN_DATA;
    const result = lib.historyPath();
    // Three-tier resolution: result must start with os.homedir() and end with history.jsonl
    // (tier 2: convention dir; tier 3: delegation-history.jsonl — both under homedir)
    assert.ok(result.startsWith(os.homedir()), 'must begin with os.homedir()');
    assert.ok(result.endsWith('history.jsonl'), 'must end with history.jsonl');
  } finally {
    if (original !== undefined) process.env.CLAUDE_PLUGIN_DATA = original;
  }
});

// ---------------------------------------------------------------------------
// 1.2.7 — counterPath(sessionId)
// ---------------------------------------------------------------------------
test('history: counterPath("sess-abc") returns correct path', () => {
  const lib = require('../scripts/lib/history');
  const expected = path.join(os.homedir(), '.claude', 'state', 'delegations-sess-abc.jsonl');
  assert.strictEqual(lib.counterPath('sess-abc'), expected);
});

// ---------------------------------------------------------------------------
// 1.2.9 — sessionStartPath(sessionId)
// ---------------------------------------------------------------------------
test('history: sessionStartPath("S1") returns correct path', () => {
  const lib = require('../scripts/lib/history');
  const expected = path.join(os.homedir(), '.claude', 'state', 'session-start-S1');
  assert.strictEqual(lib.sessionStartPath('S1'), expected);
});

// ---------------------------------------------------------------------------
// 1.2.11 — cross-platform: paths use os.homedir() and path.join (no hardcoded /)
// ---------------------------------------------------------------------------
test('history: counterPath and historyPath use os.homedir() (cross-platform)', () => {
  const lib = require('../scripts/lib/history');
  const original = process.env.CLAUDE_PLUGIN_DATA;
  try {
    delete process.env.CLAUDE_PLUGIN_DATA;
    const hPath = lib.historyPath();
    const cPath = lib.counterPath('S1');
    assert.ok(hPath.startsWith(os.homedir()), 'historyPath must use os.homedir()');
    assert.ok(cPath.startsWith(os.homedir()), 'counterPath must use os.homedir()');
    // Verify path.join separator is used (no hardcoded /)
    const sep = path.sep;
    assert.ok(hPath.includes(sep), `historyPath must use path.sep "${sep}"`);
    assert.ok(cPath.includes(sep), `counterPath must use path.sep "${sep}"`);
  } finally {
    if (original !== undefined) process.env.CLAUDE_PLUGIN_DATA = original;
  }
});

// ---------------------------------------------------------------------------
// 1.2.13 — readCounters with missing session file returns zeros
// ---------------------------------------------------------------------------
test('history: readCounters returns zeros when session file missing', () => {
  const lib = require('../scripts/lib/history');
  const result = lib.readCounters('nonexistent-session-xyz-' + Date.now());
  assert.deepStrictEqual(result, { running: 0, done: 0, failed: 0, oldestStarted: null });
});

// ---------------------------------------------------------------------------
// 1.2.15 — readCounters dedup: running then done for same id → done=1 running=0
// ---------------------------------------------------------------------------
test('history: readCounters deduplicates: running(A) + done(A) → done=1 running=0', (t, done) => {
  const lib = require('../scripts/lib/history');
  const tmpHome = mkTmpHome();
  const sid = 'dedup-test-' + Date.now();
  const stateDir = path.join(tmpHome, '.claude', 'state');
  const counterFile = path.join(stateDir, `delegations-${sid}.jsonl`);

  const lines = [
    JSON.stringify({ id: 'A', status: 'running', started: '2026-05-06T00:00:00.000Z' }),
    JSON.stringify({ id: 'A', status: 'done' }),
  ];
  fs.writeFileSync(counterFile, lines.join('\n') + '\n');

  // Override counterPath by swapping homedir reference via CLAUDE_PLUGIN_DATA trick won't work here.
  // Instead, write to the actual counterPath for this test by temporarily pointing to tmpHome.
  // We write to lib.counterPath location directly: override HOME env is not feasible since
  // os.homedir() is cached. Instead, write to the expected path directly.
  const realCounterFile = lib.counterPath(sid);
  fs.mkdirSync(path.dirname(realCounterFile), { recursive: true });
  fs.writeFileSync(realCounterFile, lines.join('\n') + '\n');

  try {
    const result = lib.readCounters(sid);
    assert.strictEqual(result.running, 0);
    assert.strictEqual(result.done, 1);
    assert.strictEqual(result.failed, 0);
  } finally {
    try { fs.unlinkSync(realCounterFile); } catch (_) {}
    cleanupTmpHome(tmpHome);
  }
  done();
});

// ---------------------------------------------------------------------------
// 1.2.17 — readCounters extracts oldestStarted
// ---------------------------------------------------------------------------
test('history: readCounters extracts oldestStarted correctly', (t, done) => {
  const lib = require('../scripts/lib/history');
  const sid = 'oldest-test-' + Date.now();
  const realCounterFile = lib.counterPath(sid);
  fs.mkdirSync(path.dirname(realCounterFile), { recursive: true });

  const lines = [
    JSON.stringify({ id: 'A', status: 'running', started: '2026-05-06T12:00:00.000Z' }),
    JSON.stringify({ id: 'B', status: 'running', started: '2026-05-06T10:00:00.000Z' }),
    JSON.stringify({ id: 'C', status: 'running', started: '2026-05-06T14:00:00.000Z' }),
  ];
  fs.writeFileSync(realCounterFile, lines.join('\n') + '\n');

  try {
    const result = lib.readCounters(sid);
    assert.strictEqual(result.oldestStarted, '2026-05-06T10:00:00.000Z');
  } finally {
    try { fs.unlinkSync(realCounterFile); } catch (_) {}
  }
  done();
});

// ---------------------------------------------------------------------------
// 1.2.19 — isoToEpochSeconds
// ---------------------------------------------------------------------------
test('history: isoToEpochSeconds("2026-05-06T00:00:00.000Z") returns expected epoch', () => {
  const lib = require('../scripts/lib/history');
  const expected = Math.floor(new Date('2026-05-06T00:00:00.000Z').getTime() / 1000);
  assert.strictEqual(lib.isoToEpochSeconds('2026-05-06T00:00:00.000Z'), expected);
});

test('history: nowEpochSeconds() returns a finite integer close to Date.now()/1000', () => {
  const lib = require('../scripts/lib/history');
  const before = Math.floor(Date.now() / 1000);
  const result = lib.nowEpochSeconds();
  const after = Math.floor(Date.now() / 1000);
  assert.ok(Number.isInteger(result), 'must be integer');
  assert.ok(result >= before && result <= after + 1, 'must be current epoch seconds');
});

// ---------------------------------------------------------------------------
// 1.2.20 — atomicWrite
// ---------------------------------------------------------------------------
test('history: atomicWrite writes content to file via rename', () => {
  const lib = require('../scripts/lib/history');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-aw-'));
  const filePath = path.join(tmpDir, 'test-atomic.txt');
  try {
    lib.atomicWrite(filePath, 'hello atomic\n');
    const content = fs.readFileSync(filePath, 'utf8');
    assert.strictEqual(content, 'hello atomic\n');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ---------------------------------------------------------------------------
// module.exports check — all expected functions exported
// ---------------------------------------------------------------------------
test('history: module exports all required functions', () => {
  const lib = require('../scripts/lib/history');
  const required = [
    'historyPath', 'counterPath', 'sessionStartPath',
    'readCounters', 'atomicWrite',
    'nowEpochSeconds', 'isoToEpochSeconds',
  ];
  for (const fn of required) {
    assert.strictEqual(typeof lib[fn], 'function', `${fn} must be exported`);
  }
});
