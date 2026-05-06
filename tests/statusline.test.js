// tests/statusline.test.js — REQ-STATUSLINE-101..107
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO_ROOT, mkTmpHome, cleanupTmpHome, runScript, counterFile, sessionStartFile } = require('./_helpers');

const STATUSLINE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'statusline.js');

// ---------------------------------------------------------------------------
// 1.3.1 — script exists and exits 0 with empty stdin
// ---------------------------------------------------------------------------
test('statusline: script exists and exits 0 with empty stdin', () => {
  assert.ok(fs.existsSync(STATUSLINE_SCRIPT), 'statusline.js must exist');
  const home = mkTmpHome();
  try {
    const result = runScript(STATUSLINE_SCRIPT, '', { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.3 — session_id absent: all counters 0, bar 10 ░, pct 0%
// ---------------------------------------------------------------------------
test('statusline: no session_id → all counters 0, empty bar', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({ model: { display_name: 'TestModel' }, context_window: { used_percentage: 0 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('0 running'), 'must show 0 running');
    assert.ok(result.stdout.includes('0 done'), 'must show 0 done');
    assert.ok(result.stdout.includes('░░░░░░░░░░'), 'must show 10 empty cells');
    assert.ok(result.stdout.includes('0%'), 'must show 0%');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.5 — pct=45 → 4 filled █ + 6 ░, color green
// ---------------------------------------------------------------------------
test('statusline: pct=45 → 4 filled cells + 6 empty, green color', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({ session_id: 'S1', model: { display_name: 'M' }, context_window: { used_percentage: 45 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    // Strip ANSI for counting
    const plain = result.stdout.replace(/\x1b\[[0-9;]*m/g, '');
    const filled = (plain.match(/█/g) || []).length;
    const empty = (plain.match(/░/g) || []).length;
    assert.strictEqual(filled, 4, 'must have 4 filled cells');
    assert.strictEqual(empty, 6, 'must have 6 empty cells');
    assert.ok(result.stdout.includes('\x1b[32m'), 'must use green ANSI color');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.7 — pct=65 → yellow
// ---------------------------------------------------------------------------
test('statusline: pct=65 → yellow color', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({ session_id: 'S1', model: { display_name: 'M' }, context_window: { used_percentage: 65 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('\x1b[33m'), 'must use yellow ANSI color');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.9 — pct=85 → red
// ---------------------------------------------------------------------------
test('statusline: pct=85 → red color', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({ session_id: 'S1', model: { display_name: 'M' }, context_window: { used_percentage: 85 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('\x1b[31m'), 'must use red ANSI color');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.11 — missing counter JSONL → 0 running 0 done 0 failed, exit 0
// ---------------------------------------------------------------------------
test('statusline: missing counter JSONL → zero counters, exit 0', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({ session_id: 'NOSESSION', model: { display_name: 'M' }, context_window: { used_percentage: 20 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('⚡ 0 running'), 'must show 0 running');
    assert.ok(result.stdout.includes('✓ 0 done'), 'must show 0 done');
    assert.ok(result.stdout.includes('✗ 0 failed'), 'must show 0 failed');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.13 — malformed stdin → exits 0, fallback output
// ---------------------------------------------------------------------------
test('statusline: malformed stdin → exits 0, fallback output', () => {
  const home = mkTmpHome();
  try {
    const result = runScript(STATUSLINE_SCRIPT, '{bad json', { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[?]'), 'must show fallback model ?');
    assert.ok(result.stdout.includes('0%'), 'must show 0%');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.15 — session-start file created when session_id given and file doesn't exist
// ---------------------------------------------------------------------------
test('statusline: session-start file created on first run', () => {
  const home = mkTmpHome();
  try {
    const sid = 'SESS_NEW_' + Date.now();
    const startFile = sessionStartFile(home, sid);
    assert.ok(!fs.existsSync(startFile), 'start file must not exist before first run');

    const payload = JSON.stringify({ session_id: sid, model: { display_name: 'M' }, context_window: { used_percentage: 20 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);

    assert.ok(fs.existsSync(startFile), 'session-start file must be created');
    const content = fs.readFileSync(startFile, 'utf8').trim();
    const epoch = parseInt(content, 10);
    assert.ok(Number.isFinite(epoch) && epoch > 0, 'session-start file must contain a valid epoch integer');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.17 — session-start file NOT overwritten if it already exists
// ---------------------------------------------------------------------------
test('statusline: session-start file not overwritten on subsequent runs', () => {
  const home = mkTmpHome();
  try {
    const sid = 'SESS_EXISTING_' + Date.now();
    const startFile = sessionStartFile(home, sid);
    const originalEpoch = Math.floor(Date.now() / 1000) - 100;
    fs.mkdirSync(path.dirname(startFile), { recursive: true });
    fs.writeFileSync(startFile, String(originalEpoch));

    const payload = JSON.stringify({ session_id: sid, model: { display_name: 'M' }, context_window: { used_percentage: 20 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);

    const afterContent = fs.readFileSync(startFile, 'utf8').trim();
    assert.strictEqual(parseInt(afterContent, 10), originalEpoch, 'session-start file must not be overwritten');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.19 — elapsed segment format
// ---------------------------------------------------------------------------
test('statusline: elapsed format < 60s shows "Xs"', () => {
  const home = mkTmpHome();
  try {
    const sid = 'ELAP_S_' + Date.now();
    const startFile = sessionStartFile(home, sid);
    fs.mkdirSync(path.dirname(startFile), { recursive: true });
    const epochNow = Math.floor(Date.now() / 1000);
    fs.writeFileSync(startFile, String(epochNow - 30));

    const payload = JSON.stringify({ session_id: sid, model: { display_name: 'M' }, context_window: { used_percentage: 20 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('⏱'), 'must show elapsed segment');
    assert.ok(result.stdout.match(/\d+s/), 'must show Xs format');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: elapsed format 60-3599s shows "Xm Ys"', () => {
  const home = mkTmpHome();
  try {
    const sid = 'ELAP_M_' + Date.now();
    const startFile = sessionStartFile(home, sid);
    fs.mkdirSync(path.dirname(startFile), { recursive: true });
    const epochNow = Math.floor(Date.now() / 1000);
    fs.writeFileSync(startFile, String(epochNow - 90));

    const payload = JSON.stringify({ session_id: sid, model: { display_name: 'M' }, context_window: { used_percentage: 20 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('⏱'), 'must show elapsed segment');
    assert.ok(result.stdout.match(/\d+m \d+s/), 'must show Xm Ys format');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: elapsed format >=3600s shows "Xh Ym"', () => {
  const home = mkTmpHome();
  try {
    const sid = 'ELAP_H_' + Date.now();
    const startFile = sessionStartFile(home, sid);
    fs.mkdirSync(path.dirname(startFile), { recursive: true });
    const epochNow = Math.floor(Date.now() / 1000);
    fs.writeFileSync(startFile, String(epochNow - 3700));

    const payload = JSON.stringify({ session_id: sid, model: { display_name: 'M' }, context_window: { used_percentage: 20 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('⏱'), 'must show elapsed segment');
    assert.ok(result.stdout.match(/\d+h \d+m/), 'must show Xh Ym format');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.21 — elapsed from oldestStarted in JSONL takes priority over session-start file
// ---------------------------------------------------------------------------
test('statusline: elapsed computed from oldestStarted in JSONL (takes priority)', () => {
  const home = mkTmpHome();
  try {
    const sid = 'OLDEST_PRIO_' + Date.now();
    const stateDir = path.join(home, '.claude', 'state');
    const cFile = path.join(stateDir, `delegations-${sid}.jsonl`);
    const startFile = path.join(stateDir, `session-start-${sid}`);

    // JSONL oldest started 120s ago
    const now = Math.floor(Date.now() / 1000);
    const oldestIso = new Date((now - 120) * 1000).toISOString();
    const newerIso = new Date((now - 10) * 1000).toISOString();

    fs.writeFileSync(cFile, JSON.stringify({ id: 'A', status: 'running', started: newerIso }) + '\n');
    fs.appendFileSync(cFile, JSON.stringify({ id: 'B', status: 'running', started: oldestIso }) + '\n');

    // Session-start from 30s ago (should NOT win)
    fs.writeFileSync(startFile, String(now - 30));

    const payload = JSON.stringify({ session_id: sid, model: { display_name: 'M' }, context_window: { used_percentage: 20 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    // 120s from JSONL means elapsed >= 2m
    assert.ok(result.stdout.includes('⏱'), 'must show elapsed');
    assert.ok(result.stdout.match(/[12]m/), 'elapsed must reflect oldest JSONL entry (~120s = 2m)');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// 1.3.23 — exact output snapshot test
// ---------------------------------------------------------------------------
test('statusline: exact output format snapshot test', () => {
  const home = mkTmpHome();
  try {
    const sid = 'SNAP_' + Date.now();
    const stateDir = path.join(home, '.claude', 'state');
    const cFile = path.join(stateDir, `delegations-${sid}.jsonl`);
    const startFile = path.join(stateDir, `session-start-${sid}`);

    // Fixed epoch for deterministic elapsed
    const baseEpoch = Math.floor(Date.now() / 1000);
    fs.writeFileSync(startFile, String(baseEpoch));

    // Fixed JSONL: 1 running, 2 done, 1 failed
    const iso = new Date(baseEpoch * 1000).toISOString();
    fs.writeFileSync(cFile, [
      JSON.stringify({ id: 'A', status: 'running', started: iso }),
      JSON.stringify({ id: 'B', status: 'done' }),
      JSON.stringify({ id: 'C', status: 'done' }),
      JSON.stringify({ id: 'D', status: 'running', started: iso }),
      JSON.stringify({ id: 'D', status: 'failed' }),
    ].join('\n') + '\n');

    const payload = JSON.stringify({
      session_id: sid,
      model: { display_name: 'claude-sonnet-4-6' },
      context_window: { used_percentage: 40 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);

    // Check all structural elements
    assert.ok(result.stdout.includes('[claude-sonnet-4-6]'), 'must include model name');
    assert.ok(result.stdout.includes('████'), 'must include filled bar cells');
    assert.ok(result.stdout.includes('40%'), 'must show 40%');
    assert.ok(result.stdout.includes('⚡ 1 running'), 'must show 1 running');
    assert.ok(result.stdout.includes('✓ 2 done'), 'must show 2 done');
    assert.ok(result.stdout.includes('✗ 1 failed'), 'must show 1 failed');
    assert.ok(result.stdout.includes('⏱'), 'must show elapsed segment');
    assert.ok(result.stdout.endsWith('\n'), 'must end with newline');
    assert.ok(result.stdout.includes('\x1b[32m'), 'must have green color at 40%');
    assert.ok(result.stdout.includes('\x1b[0m'), 'must have ANSI reset');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// Counter math tests
// ---------------------------------------------------------------------------
test('statusline: counter dedup — running(A)+done(A) → running=0 done=1', () => {
  const home = mkTmpHome();
  try {
    const sid = 'DEDUP_' + Date.now();
    const stateDir = path.join(home, '.claude', 'state');
    const cFile = path.join(stateDir, `delegations-${sid}.jsonl`);
    fs.writeFileSync(cFile, [
      JSON.stringify({ id: 'A', status: 'running', started: '2026-05-06T00:00:00.000Z' }),
      JSON.stringify({ id: 'A', status: 'done' }),
    ].join('\n') + '\n');

    const payload = JSON.stringify({ session_id: sid, model: { display_name: 'M' }, context_window: { used_percentage: 20 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('0 running'), 'must show 0 running');
    assert.ok(result.stdout.includes('1 done'), 'must show 1 done');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: counter — failed excluded from running', () => {
  const home = mkTmpHome();
  try {
    const sid = 'FAIL_EXCL_' + Date.now();
    const stateDir = path.join(home, '.claude', 'state');
    const cFile = path.join(stateDir, `delegations-${sid}.jsonl`);
    const iso = new Date().toISOString();
    fs.writeFileSync(cFile, [
      JSON.stringify({ id: 'F', status: 'running', started: iso }),
      JSON.stringify({ id: 'F', status: 'failed' }),
    ].join('\n') + '\n');

    const payload = JSON.stringify({ session_id: sid, model: { display_name: 'M' }, context_window: { used_percentage: 20 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('0 running'), 'failed must not count as running');
    assert.ok(result.stdout.includes('1 failed'), 'must show 1 failed');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: pct=150 clamped to 100, bar fully filled, red', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({ session_id: 'HI', model: { display_name: 'M' }, context_window: { used_percentage: 150 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    const plain = result.stdout.replace(/\x1b\[[0-9;]*m/g, '');
    const filled = (plain.match(/█/g) || []).length;
    assert.strictEqual(filled, 10, 'must have 10 filled cells at pct=150');
    assert.ok(result.stdout.includes('\x1b[31m'), 'must be red at pct=150');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: pct=-5 clamped to 0, bar empty, green', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({ session_id: 'LO', model: { display_name: 'M' }, context_window: { used_percentage: -5 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    const plain = result.stdout.replace(/\x1b\[[0-9;]*m/g, '');
    const empty = (plain.match(/░/g) || []).length;
    assert.strictEqual(empty, 10, 'must have 10 empty cells at pct=-5');
    assert.ok(result.stdout.includes('\x1b[32m'), 'must be green at pct=-5');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: output includes failed segment always (even when 0)', () => {
  const home = mkTmpHome();
  try {
    const sid = 'ALWAYS_FAIL_' + Date.now();
    const stateDir = path.join(home, '.claude', 'state');
    const cFile = path.join(stateDir, `delegations-${sid}.jsonl`);
    fs.writeFileSync(cFile, JSON.stringify({ id: 'A', status: 'done' }) + '\n');

    const payload = JSON.stringify({ session_id: sid, model: { display_name: 'M' }, context_window: { used_percentage: 20 } });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('✗ 0 failed'), 'failed segment must always be rendered');
  } finally {
    cleanupTmpHome(home);
  }
});
