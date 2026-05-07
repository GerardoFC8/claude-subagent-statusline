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
    assert.ok(result.stdout.includes('⚡ 0'), 'must show 0 running');
    assert.ok(result.stdout.includes('✓ 0'), 'must show 0 done');
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
    assert.ok(result.stdout.includes('⚡ 0'), 'must show 0 running');
    assert.ok(result.stdout.includes('✓ 0'), 'must show 0 done');
    assert.ok(result.stdout.includes('✗ 0'), 'must show 0 failed');
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
    assert.ok(result.stdout.includes('⚡ 1'), 'must show 1 running');
    assert.ok(result.stdout.includes('✓ 2'), 'must show 2 done');
    assert.ok(result.stdout.includes('✗ 1'), 'must show 1 failed');
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
    assert.ok(result.stdout.includes('⚡ 0'), 'must show 0 running');
    assert.ok(result.stdout.includes('✓ 1'), 'must show 1 done');
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
    assert.ok(result.stdout.includes('⚡ 0'), 'failed must not count as running');
    assert.ok(result.stdout.includes('✗ 1'), 'must show 1 failed');
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
    assert.ok(result.stdout.includes('✗ 0'), 'failed segment must always be rendered');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// Cost suffix tests — cost.total_cost_usd appended inside model bracket
// (main + sub-agents combined, computed client-side by Claude Code)
// ---------------------------------------------------------------------------
test('statusline: cost present → renders [model · $X.XX] with 2 decimals', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'COST1',
      model: { display_name: 'Sonnet' },
      context_window: { used_percentage: 20 },
      cost: { total_cost_usd: 0.42345 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Sonnet · $0.42]'), 'must render cost inside model bracket as · $0.42');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: cost = 0 → renders [model · $0.00]', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'COST_ZERO',
      model: { display_name: 'Sonnet' },
      context_window: { used_percentage: 20 },
      cost: { total_cost_usd: 0 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Sonnet · $0.00]'), 'must render zero cost as · $0.00 inside bracket');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: cost field absent → bracket stays [model] with no suffix', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'NO_COST',
      model: { display_name: 'Sonnet' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Sonnet]'), 'bracket must be plain when cost is absent');
    assert.ok(!result.stdout.includes('·'), 'must omit · separator when cost is absent');
    assert.ok(!result.stdout.includes('$'), 'must omit $ when cost is absent');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: cost is not a number → bracket stays [model] with no suffix', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'BAD_COST',
      model: { display_name: 'Sonnet' },
      context_window: { used_percentage: 20 },
      cost: { total_cost_usd: 'free' },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Sonnet]'), 'bracket must be plain when cost is non-numeric');
    assert.ok(!result.stdout.includes('$'), 'must omit $ when cost is non-numeric');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: cost suffix appears BEFORE the bar (inside opening bracket)', () => {
  const home = mkTmpHome();
  try {
    const sid = 'COST_ORDER_' + Date.now();
    const startFile = sessionStartFile(home, sid);
    fs.mkdirSync(path.dirname(startFile), { recursive: true });
    fs.writeFileSync(startFile, String(Math.floor(Date.now() / 1000) - 30));

    const payload = JSON.stringify({
      session_id: sid,
      model: { display_name: 'Sonnet' },
      context_window: { used_percentage: 20 },
      cost: { total_cost_usd: 1.23 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    const idxCost = result.stdout.indexOf('$1.23');
    const idxBar = result.stdout.search(/[█░]/);
    assert.ok(idxCost > 0 && idxBar > 0, 'both cost and bar must be present');
    assert.ok(idxCost < idxBar, 'cost must appear before the progress bar');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// Model name normalization — strip trailing "(...context...)" annotation
// ---------------------------------------------------------------------------
test('statusline: model name "(1M context)" suffix is stripped', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'M1',
      model: { display_name: 'Opus 4.7 (1M context)' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Opus 4.7]'), 'must strip "(1M context)" annotation');
    assert.ok(!result.stdout.includes('context'), 'must not leave "context" word in output');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: model name "(200K context)" suffix is stripped', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'M2',
      model: { display_name: 'Sonnet 4.6 (200K context)' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Sonnet 4.6]'), 'must strip any "(... context)" annotation');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: model name without context suffix is preserved unchanged', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'M3',
      model: { display_name: 'Opus 4.7' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Opus 4.7]'), 'plain model name must be preserved');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// Rate limit segments — five_hour ("Ventana 5h") and seven_day ("Semana")
// ---------------------------------------------------------------------------
test('statusline: both rate limits present → joined "Ventana 5h ... · Semana ..."', () => {
  const home = mkTmpHome();
  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      session_id: 'RL1',
      model: { display_name: 'M' },
      context_window: { used_percentage: 20 },
      rate_limits: {
        five_hour: { used_percentage: 13, resets_at: now + 4080 },        // 1h 8m
        seven_day: { used_percentage: 4, resets_at: now + 488400 },       // 5d 15h
      },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('Ventana 5h:'), 'must label five-hour window');
    assert.ok(result.stdout.includes('13%'), 'must show 5h percentage');
    assert.ok(result.stdout.match(/reset en 1h \d+m/), 'must format 5h reset as "Xh Ym"');
    assert.ok(result.stdout.includes('Semana:'), 'must label seven-day window');
    assert.ok(result.stdout.includes('4%'), 'must show 7d percentage');
    assert.ok(result.stdout.match(/reset en 5d \d+h/), 'must format 7d reset as "Xd Yh"');
    const idx5h = result.stdout.indexOf('Ventana 5h');
    const idx7d = result.stdout.indexOf('Semana');
    assert.ok(idx5h > 0 && idx7d > idx5h, 'Ventana 5h must come before Semana');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: only five_hour present → renders only that window', () => {
  const home = mkTmpHome();
  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      session_id: 'RL2',
      model: { display_name: 'M' },
      context_window: { used_percentage: 20 },
      rate_limits: { five_hour: { used_percentage: 50, resets_at: now + 1800 } }, // 30m
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('Ventana 5h:'), 'must render five_hour');
    assert.ok(!result.stdout.includes('Semana:'), 'must NOT render seven_day when absent');
    assert.ok(result.stdout.includes('reset en 30m'), 'sub-hour delta must format as "Xm"');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: rate_limits absent entirely → no rate-limit segment', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'RL3',
      model: { display_name: 'M' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(!result.stdout.includes('Ventana'), 'must omit Ventana label');
    assert.ok(!result.stdout.includes('Semana'), 'must omit Semana label');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: resets_at in the past → percentage shown but reset suffix omitted', () => {
  const home = mkTmpHome();
  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      session_id: 'RL4',
      model: { display_name: 'M' },
      context_window: { used_percentage: 20 },
      rate_limits: { five_hour: { used_percentage: 25, resets_at: now - 60 } },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('Ventana 5h:'), 'must still render the percentage');
    assert.ok(result.stdout.includes('25%'), 'must show percentage');
    assert.ok(!result.stdout.includes('(reset en'), 'must omit "reset en" when delta <= 0');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: used_percentage non-numeric → that window omitted', () => {
  const home = mkTmpHome();
  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      session_id: 'RL5',
      model: { display_name: 'M' },
      context_window: { used_percentage: 20 },
      rate_limits: {
        five_hour: { used_percentage: 'oops', resets_at: now + 600 },
        seven_day: { used_percentage: 4, resets_at: now + 488400 },
      },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(!result.stdout.includes('Ventana 5h:'), 'must omit five_hour when percentage is non-numeric');
    assert.ok(result.stdout.includes('Semana:'), 'must still render valid seven_day');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: elapsed segment ⏱ appears BEFORE the ⚡ running counter', () => {
  const home = mkTmpHome();
  try {
    const sid = 'ELAP_ORDER_' + Date.now();
    const startFile = sessionStartFile(home, sid);
    fs.mkdirSync(path.dirname(startFile), { recursive: true });
    fs.writeFileSync(startFile, String(Math.floor(Date.now() / 1000) - 30));

    const payload = JSON.stringify({
      session_id: sid,
      model: { display_name: 'M' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    const idxElapsed = result.stdout.indexOf('⏱');
    const idxRunning = result.stdout.indexOf('⚡');
    assert.ok(idxElapsed > 0 && idxRunning > 0, 'both segments must be present');
    assert.ok(idxElapsed < idxRunning, 'elapsed must come before running counter');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// Model name parsed from `.model.id`
// ---------------------------------------------------------------------------
test('statusline: model.id "claude-opus-4-7" → "Opus 4.7"', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'MID1',
      model: { id: 'claude-opus-4-7', display_name: 'Opus 4.7 (1M context)' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Opus 4.7]'), 'must parse Opus 4.7 from id');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: model.id "claude-sonnet-4-6" → "Sonnet 4.6"', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'MID2',
      model: { id: 'claude-sonnet-4-6' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Sonnet 4.6]'), 'must parse Sonnet 4.6 from id');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: model.id "claude-haiku-4-5" → "Haiku 4.5"', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'MID3',
      model: { id: 'claude-haiku-4-5' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Haiku 4.5]'), 'must parse Haiku 4.5 from id');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: malformed model.id falls back to display_name with strip', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'MID4',
      model: { id: 'gpt-4-turbo', display_name: 'Custom Model (1M context)' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Custom Model]'), 'must fall back to stripped display_name');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// Effort level segment — appended to model bracket
// ---------------------------------------------------------------------------
test('statusline: effort.level present → renders " · <level>" inside model bracket', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'EF1',
      model: { id: 'claude-opus-4-7' },
      effort: { level: 'high' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Opus 4.7 · high]'), 'must include effort level inside bracket');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: effort absent → no effort suffix', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'EF2',
      model: { id: 'claude-opus-4-7' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Opus 4.7]'), 'bracket must contain only model when effort absent');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: model + effort + cost render in order [model · effort · $cost]', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'COMBO',
      model: { id: 'claude-opus-4-7' },
      effort: { level: 'medium' },
      context_window: { used_percentage: 20 },
      cost: { total_cost_usd: 2.5 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('[Opus 4.7 · medium · $2.50]'), 'bracket must combine all three');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// Folder segment — basename of workspace.current_dir, bold at start
// ---------------------------------------------------------------------------
test('statusline: workspace.current_dir → bold folder basename at start', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'F1',
      model: { id: 'claude-opus-4-7' },
      workspace: { current_dir: '/home/foo/Projects/my-app' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    // Bold ANSI: \x1b[1m before "my-app", \x1b[22m after
    assert.ok(result.stdout.includes('\x1b[1mmy-app\x1b[22m'), 'folder must render in bold');
    // Folder must come BEFORE the model bracket
    const idxFolder = result.stdout.indexOf('my-app');
    const idxBracket = result.stdout.indexOf('[Opus 4.7');
    assert.ok(idxFolder > 0 && idxBracket > 0, 'both must be present');
    assert.ok(idxFolder < idxBracket, 'folder must precede model bracket');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: cwd as fallback when workspace.current_dir absent', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'F2',
      model: { id: 'claude-opus-4-7' },
      cwd: '/var/www/api-server',
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('api-server'), 'must fall back to cwd basename');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: folder absent → no folder prefix', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'F3',
      model: { id: 'claude-opus-4-7' },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.startsWith('[Opus 4.7]'), 'output must start with model bracket when no folder');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: folder equal to $HOME → renders "~"', () => {
  const home = mkTmpHome();
  try {
    const payload = JSON.stringify({
      session_id: 'F4',
      model: { id: 'claude-opus-4-7' },
      workspace: { current_dir: home },
      context_window: { used_percentage: 20 },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('\x1b[1m~\x1b[22m'), 'home dir must render as bold "~"');
  } finally {
    cleanupTmpHome(home);
  }
});

// ---------------------------------------------------------------------------
// Separator simplification — between failed and Ventana 5h
// ---------------------------------------------------------------------------
test('statusline: separator between failed and Ventana 5h is single "·" (not "· │ ·")', () => {
  const home = mkTmpHome();
  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      session_id: 'SEP1',
      model: { id: 'claude-opus-4-7' },
      context_window: { used_percentage: 20 },
      rate_limits: { five_hour: { used_percentage: 10, resets_at: now + 600 } },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    assert.ok(!result.stdout.includes('· │ ·'), 'must not use compound "· │ ·" separator');
    assert.ok(result.stdout.match(/✗ \d+ · Ventana 5h:/), 'must use single "·" between failed counter and Ventana');
  } finally {
    cleanupTmpHome(home);
  }
});

test('statusline: rate-limit percentage colored by threshold (green/yellow/red)', () => {
  const home = mkTmpHome();
  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      session_id: 'RL6',
      model: { display_name: 'M' },
      context_window: { used_percentage: 20 },
      rate_limits: {
        five_hour: { used_percentage: 30, resets_at: now + 600 },   // green
        seven_day: { used_percentage: 90, resets_at: now + 600 },   // red
      },
    });
    const result = runScript(STATUSLINE_SCRIPT, payload, { HOME: home, USERPROFILE: home });
    assert.strictEqual(result.status, 0);
    // Must contain both green and red ANSI codes wrapping the rate-limit percentages.
    assert.ok(result.stdout.includes('\x1b[32m30%'), 'five_hour at 30% must be green');
    assert.ok(result.stdout.includes('\x1b[31m90%'), 'seven_day at 90% must be red');
  } finally {
    cleanupTmpHome(home);
  }
});
