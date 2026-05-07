// tests/history.test.js — read-side (slice 1) + write-side (slice 2)
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
// module.exports check — all expected functions exported (slice 1 + slice 2)
// ---------------------------------------------------------------------------
test('history: module exports all required functions', () => {
  const lib = require('../scripts/lib/history');
  const required = [
    'historyPath', 'counterPath', 'sessionStartPath',
    'readCounters', 'atomicWrite',
    'nowEpochSeconds', 'isoToEpochSeconds',
    // slice 2 write-side
    'historyAppend', 'counterAppend', 'historyTrimIfNeeded', 'nowIsoZ',
  ];
  for (const fn of required) {
    assert.strictEqual(typeof lib[fn], 'function', `${fn} must be exported`);
  }
});

// ===========================================================================
// SLICE 2 — WRITE-SIDE TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// 2.1.1 — nowIsoZ() returns UTC Z-suffix timestamp
// ---------------------------------------------------------------------------
test('history: nowIsoZ() returns UTC Z timestamp', () => {
  const lib = require('../scripts/lib/history');
  const ts = lib.nowIsoZ();
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    'nowIsoZ must return ISO 8601 UTC Z format');
});

// ---------------------------------------------------------------------------
// 2.1.3 — counterAppend creates directory and writes lean line to session file
// ---------------------------------------------------------------------------
test('history: counterAppend creates lean entry in counter file (REQ-HISTORY-106)', () => {
  // We use CLAUDE_PLUGIN_DATA to isolate the historyPath, but counterPath uses
  // os.homedir() directly. Use a real tmp dir for counter file isolation by
  // writing to lib.counterPath(sid) after ensuring the dir exists.
  const lib = require('../scripts/lib/history');
  const sid = 'counter-write-test-' + Date.now();
  const counterFilePath = lib.counterPath(sid);
  // Ensure we clean up after test
  try {
    lib.counterAppend(sid, { id: 'toolu_X', status: 'running', started: lib.nowIsoZ() });
    assert.ok(fs.existsSync(counterFilePath), 'counter file must be created');
    const lines = fs.readFileSync(counterFilePath, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1, 'must contain exactly one line');
    const obj = JSON.parse(lines[0]);
    assert.strictEqual(obj.id, 'toolu_X');
    assert.strictEqual(obj.status, 'running');
  } finally {
    try { fs.unlinkSync(counterFilePath); } catch (_) {}
  }
});

// ---------------------------------------------------------------------------
// 2.1.5 — historyAppend creates directory and writes line (REQ-HISTORY-103)
// ---------------------------------------------------------------------------
test('history: historyAppend creates directory and writes JSONL line (REQ-HISTORY-103)', () => {
  const lib = require('../scripts/lib/history');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-hist-'));
  const origEnv = process.env.CLAUDE_PLUGIN_DATA;
  try {
    process.env.CLAUDE_PLUGIN_DATA = tmpDir;
    lib.historyAppend({ status: 'running', id: 'x' });
    const histFile = path.join(tmpDir, 'history.jsonl');
    assert.ok(fs.existsSync(histFile), 'history file must be created');
    const lines = fs.readFileSync(histFile, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1);
    const obj = JSON.parse(lines[0]);
    assert.strictEqual(obj.status, 'running');
    assert.strictEqual(obj.id, 'x');
  } finally {
    if (origEnv === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = origEnv;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ---------------------------------------------------------------------------
// 2.1.7 — historyAppend appends multiple lines
// ---------------------------------------------------------------------------
test('history: historyAppend appends multiple lines sequentially', () => {
  const lib = require('../scripts/lib/history');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-hist2-'));
  const origEnv = process.env.CLAUDE_PLUGIN_DATA;
  try {
    process.env.CLAUDE_PLUGIN_DATA = tmpDir;
    lib.historyAppend({ id: '1', status: 'running' });
    lib.historyAppend({ id: '2', status: 'done' });
    lib.historyAppend({ id: '3', status: 'failed' });
    const histFile = path.join(tmpDir, 'history.jsonl');
    const lines = fs.readFileSync(histFile, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 3, 'must have 3 lines');
    assert.strictEqual(JSON.parse(lines[0]).id, '1');
    assert.strictEqual(JSON.parse(lines[1]).id, '2');
    assert.strictEqual(JSON.parse(lines[2]).id, '3');
  } finally {
    if (origEnv === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = origEnv;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ---------------------------------------------------------------------------
// 2.1.9 — historyTrimIfNeeded: no trim at or below 600 lines (REQ-HISTORY-104)
// ---------------------------------------------------------------------------
test('history: historyTrimIfNeeded no-op when line count <= 600 (REQ-HISTORY-104)', () => {
  const lib = require('../scripts/lib/history');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-trim-'));
  const origEnv = process.env.CLAUDE_PLUGIN_DATA;
  try {
    process.env.CLAUDE_PLUGIN_DATA = tmpDir;
    // Write exactly 600 lines
    const histFile = path.join(tmpDir, 'history.jsonl');
    fs.mkdirSync(tmpDir, { recursive: true });
    const lines600 = Array.from({ length: 600 }, (_, i) => JSON.stringify({ id: String(i) }));
    fs.writeFileSync(histFile, lines600.join('\n') + '\n');
    lib.historyTrimIfNeeded();
    const after = fs.readFileSync(histFile, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(after.length, 600, 'must still have 600 lines — no trim at threshold');
  } finally {
    if (origEnv === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = origEnv;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ---------------------------------------------------------------------------
// 2.1.11 — historyTrimIfNeeded: trim fires at 601, keeps last 500 (REQ-HISTORY-104)
// ---------------------------------------------------------------------------
test('history: historyTrimIfNeeded trims to 500 when line count > 600 (REQ-HISTORY-104)', () => {
  const lib = require('../scripts/lib/history');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-trim2-'));
  const origEnv = process.env.CLAUDE_PLUGIN_DATA;
  try {
    process.env.CLAUDE_PLUGIN_DATA = tmpDir;
    const histFile = path.join(tmpDir, 'history.jsonl');
    fs.mkdirSync(tmpDir, { recursive: true });
    // Write 601 lines; line N has id=N so we can verify we kept the last 500
    const lines601 = Array.from({ length: 601 }, (_, i) => JSON.stringify({ id: String(i) }));
    fs.writeFileSync(histFile, lines601.join('\n') + '\n');
    lib.historyTrimIfNeeded();
    const after = fs.readFileSync(histFile, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(after.length, 500, 'must have exactly 500 lines after trim');
    // The last 500 of 601 are ids 101..600
    assert.strictEqual(JSON.parse(after[0]).id, '101', 'first line must be id 101 (oldest kept)');
    assert.strictEqual(JSON.parse(after[499]).id, '600', 'last line must be id 600 (newest)');
  } finally {
    if (origEnv === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = origEnv;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ---------------------------------------------------------------------------
// 2.1.13 — historyTrimIfNeeded: no-op when file does not exist
// ---------------------------------------------------------------------------
test('history: historyTrimIfNeeded is no-op when file does not exist', () => {
  const lib = require('../scripts/lib/history');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-trim3-'));
  const origEnv = process.env.CLAUDE_PLUGIN_DATA;
  try {
    process.env.CLAUDE_PLUGIN_DATA = tmpDir;
    // Do NOT create history file
    assert.doesNotThrow(() => lib.historyTrimIfNeeded(),
      'historyTrimIfNeeded must not throw when file is absent');
  } finally {
    if (origEnv === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = origEnv;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ---------------------------------------------------------------------------
// 2.1.15 — historyAppend + historyTrimIfNeeded integration: 601st append triggers trim
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// findToolUseIdByAgentId — correlates SubagentStop's agent_id back to tool_use_id
// ---------------------------------------------------------------------------
// Helper: redirect os.homedir() in-process for in-memory tests.
// On Linux/macOS, os.homedir() reads $HOME. On Windows, it reads USERPROFILE.
// Set both so the same test body works cross-platform.
function withHomeDir(tmpDir, fn) {
  const origHome = process.env.HOME;
  const origProfile = process.env.USERPROFILE;
  process.env.HOME = tmpDir;
  process.env.USERPROFILE = tmpDir;
  try {
    return fn();
  } finally {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
    if (origProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origProfile;
  }
}

test('history: findToolUseIdByAgentId returns matching tool_use_id when agent_id is in JSONL', () => {
  const lib = require('../scripts/lib/history');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-findid-'));
  try {
    const sid = 'find-' + Date.now();
    const dir = path.join(tmpDir, '.claude', 'state');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `delegations-${sid}.jsonl`);
    fs.writeFileSync(file, [
      JSON.stringify({ id: 'toolu_A', status: 'running', started: new Date().toISOString() }),
      JSON.stringify({ id: 'toolu_A', agent_id: 'agent_A', status: 'bg_launched' }),
      JSON.stringify({ id: 'toolu_B', status: 'running', started: new Date().toISOString() }),
      JSON.stringify({ id: 'toolu_B', agent_id: 'agent_B', status: 'bg_launched' }),
    ].join('\n') + '\n');

    withHomeDir(tmpDir, () => {
      assert.strictEqual(lib.findToolUseIdByAgentId(sid, 'agent_A'), 'toolu_A');
      assert.strictEqual(lib.findToolUseIdByAgentId(sid, 'agent_B'), 'toolu_B');
      assert.strictEqual(lib.findToolUseIdByAgentId(sid, 'agent_unknown'), null);
      assert.strictEqual(lib.findToolUseIdByAgentId('', 'agent_A'), null);
      assert.strictEqual(lib.findToolUseIdByAgentId(sid, ''), null);
    });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('history: bg flow — readCounters keeps id as running across bg_launched, transitions to done after SubagentStop', () => {
  const lib = require('../scripts/lib/history');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-bgflow-'));
  try {
    const sid = 'bgflow-' + Date.now();
    const dir = path.join(tmpDir, '.claude', 'state');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `delegations-${sid}.jsonl`);
    withHomeDir(tmpDir, () => {
      // Step 1 — PreToolUse fires for a background launch
      fs.writeFileSync(file, JSON.stringify({ id: 'toolu_BG', status: 'running', started: new Date().toISOString(), background: true }) + '\n');
      let c = lib.readCounters(sid);
      assert.strictEqual(c.running, 1, 'after PreToolUse, must count as running');
      assert.strictEqual(c.done, 0);

      // Step 2 — PostToolUse(async_launched) appends bg_launched mapping (NOT done)
      fs.appendFileSync(file, JSON.stringify({ id: 'toolu_BG', agent_id: 'agent_BG', status: 'bg_launched' }) + '\n');
      c = lib.readCounters(sid);
      assert.strictEqual(c.running, 1, 'after bg_launched, must STILL count as running');
      assert.strictEqual(c.done, 0, 'must NOT count as done — sub-agent still working');

      // Step 3 — SubagentStop appends done
      fs.appendFileSync(file, JSON.stringify({ id: 'toolu_BG', ended: new Date().toISOString(), status: 'done' }) + '\n');
      c = lib.readCounters(sid);
      assert.strictEqual(c.running, 0, 'after SubagentStop done, must transition out of running');
      assert.strictEqual(c.done, 1, 'must count as done');
    });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('history: findToolUseIdByAgentId returns null when counter file does not exist', () => {
  const lib = require('../scripts/lib/history');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-findid-'));
  try {
    withHomeDir(tmpDir, () => {
      assert.strictEqual(lib.findToolUseIdByAgentId('nonexistent', 'agent_X'), null);
    });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('history: historyAppend followed by historyTrimIfNeeded trims correctly at 601', () => {
  const lib = require('../scripts/lib/history');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-integtrim-'));
  const origEnv = process.env.CLAUDE_PLUGIN_DATA;
  try {
    process.env.CLAUDE_PLUGIN_DATA = tmpDir;
    const histFile = path.join(tmpDir, 'history.jsonl');
    // Pre-write 600 lines
    const lines600 = Array.from({ length: 600 }, (_, i) => JSON.stringify({ id: String(i) }));
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(histFile, lines600.join('\n') + '\n');
    // historyAppend adds the 601st line, then calls historyTrimIfNeeded
    lib.historyAppend({ id: '600' });
    const after = fs.readFileSync(histFile, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(after.length, 500, 'must trim to 500 after 601st append');
  } finally {
    if (origEnv === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = origEnv;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});
