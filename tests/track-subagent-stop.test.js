// tests/track-subagent-stop.test.js
// Tests for the SubagentStop hook (v0.10.0 — background agent counter accuracy).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScript, readJsonl, counterFile, REPO_ROOT } = require('./_helpers');

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'track-subagent-stop.js');

// Build a counter file simulating a prior PreToolUse + PostToolUse(async_launched).
function seedBgCounterFile(home, sessionId, toolUseId, agentId) {
  const dir = path.join(home, '.claude', 'state');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `delegations-${sessionId}.jsonl`);
  fs.writeFileSync(file, [
    JSON.stringify({ id: toolUseId, type: 'general-purpose', desc: 'bg test', started: new Date().toISOString(), status: 'running', background: true }),
    JSON.stringify({ id: toolUseId, agent_id: agentId, status: 'bg_launched' }),
  ].join('\n') + '\n');
  return file;
}

// ---------------------------------------------------------------------------
// Happy path — agent_id matches a bg_launched entry → writes done
// ---------------------------------------------------------------------------
test('track-subagent-stop: matching agent_id closes the bg entry as done', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-stop-'));
  const sid = 'stop-match-' + Date.now();
  const tuid = 'toolu_bg_xyz';
  const aid = 'ae8b0c9eb8c3f70bd';
  seedBgCounterFile(tmpDir, sid, tuid, aid);

  const payload = JSON.stringify({ session_id: sid, agent_id: aid });
  const { status } = runScript(SCRIPT, payload, {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0);

  const cLines = readJsonl(counterFile(tmpDir, sid));
  const done = cLines.find(l => l.status === 'done');
  assert.ok(done, 'must append a done entry');
  assert.strictEqual(done.id, tuid, 'done entry must use the correlated tool_use_id');
  assert.match(done.ended, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'ended must be UTC Z');

  const hFile = path.join(tmpDir, 'histdata', 'history.jsonl');
  const hLines = readJsonl(hFile);
  const hDone = hLines.find(l => l.status === 'done' && l.tool_use_id === tuid);
  assert.ok(hDone, 'history must record the done entry');
  assert.strictEqual(hDone.agent_id, aid, 'history done entry must include agent_id');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// No match — foreground sub-agent's SubagentStop must be silently ignored
// ---------------------------------------------------------------------------
test('track-subagent-stop: unknown agent_id (foreground) is a no-op', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-stop-'));
  const sid = 'stop-fg-' + Date.now();
  // Counter has only foreground entries — no bg_launched mapping.
  const dir = path.join(tmpDir, '.claude', 'state');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `delegations-${sid}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ id: 'toolu_fg', status: 'running', started: new Date().toISOString() }) + '\n');

  const payload = JSON.stringify({ session_id: sid, agent_id: 'a666aa51201de79e0' });
  const before = fs.readFileSync(file, 'utf8');
  const { status } = runScript(SCRIPT, payload, {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  const after = fs.readFileSync(file, 'utf8');
  assert.strictEqual(status, 0);
  assert.strictEqual(after, before, 'counter file must be unchanged');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// Missing fields — exits 0 without writing
// ---------------------------------------------------------------------------
test('track-subagent-stop: missing session_id exits 0 without writing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-stop-'));
  const payload = JSON.stringify({ agent_id: 'whatever' });
  const { status } = runScript(SCRIPT, payload, {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('track-subagent-stop: missing agent_id exits 0 without writing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-stop-'));
  const payload = JSON.stringify({ session_id: 'sess-' + Date.now() });
  const { status } = runScript(SCRIPT, payload, {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('track-subagent-stop: malformed stdin exits 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-stop-'));
  const { status } = runScript(SCRIPT, '{ this is not json', {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
  });
  assert.strictEqual(status, 0);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

test('track-subagent-stop: empty stdin exits 0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-stop-'));
  const { status } = runScript(SCRIPT, '', {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
  });
  assert.strictEqual(status, 0);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// Multiple bg agents — each SubagentStop closes only its corresponding entry
// ---------------------------------------------------------------------------
test('track-subagent-stop: with multiple bg agents in flight, only the matching id is closed', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-stop-'));
  const sid = 'stop-multi-' + Date.now();
  const dir = path.join(tmpDir, '.claude', 'state');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `delegations-${sid}.jsonl`);
  fs.writeFileSync(file, [
    JSON.stringify({ id: 'toolu_A', status: 'running', started: new Date().toISOString(), background: true }),
    JSON.stringify({ id: 'toolu_A', agent_id: 'agent_A', status: 'bg_launched' }),
    JSON.stringify({ id: 'toolu_B', status: 'running', started: new Date().toISOString(), background: true }),
    JSON.stringify({ id: 'toolu_B', agent_id: 'agent_B', status: 'bg_launched' }),
  ].join('\n') + '\n');

  // Only agent_A finishes
  runScript(SCRIPT, JSON.stringify({ session_id: sid, agent_id: 'agent_A' }), {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  const cLines = readJsonl(file);
  const doneA = cLines.find(l => l.status === 'done' && l.id === 'toolu_A');
  const doneB = cLines.find(l => l.status === 'done' && l.id === 'toolu_B');
  assert.ok(doneA, 'agent_A must be closed');
  assert.strictEqual(doneB, undefined, 'agent_B must remain open until its own SubagentStop');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// Counter file missing — exits 0 (no entry exists to close)
// ---------------------------------------------------------------------------
test('track-subagent-stop: counter file missing → exits 0 silently', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-stop-'));
  const sid = 'stop-nocounter-' + Date.now();
  const payload = JSON.stringify({ session_id: sid, agent_id: 'agent_X' });
  const { status } = runScript(SCRIPT, payload, {
    HOME: tmpDir,
    USERPROFILE: tmpDir,
    CLAUDE_PLUGIN_DATA: path.join(tmpDir, 'histdata'),
  });
  assert.strictEqual(status, 0);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});
