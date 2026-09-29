// tests/session-id.test.js — session_id path-traversal hardening.
// A session_id is interpolated into per-session state file names, so an id
// carrying path separators or dot segments must never reach the filesystem.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPO_ROOT, runScript } = require('./_helpers');

const lib = require('../scripts/lib/history');

const UUID = '3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b';
const UNSAFE_IDS = ['../x', 'a/b', 'a\\b', '..', '.', '', '../../evil'];

// ---------------------------------------------------------------------------
// safeSessionId
// ---------------------------------------------------------------------------
test('safeSessionId: accepts a UUID and plain id characters', () => {
  assert.strictEqual(lib.safeSessionId(UUID), UUID);
  assert.strictEqual(lib.safeSessionId('sess_1.a-B'), 'sess_1.a-B');
});

test('safeSessionId: rejects traversal, separators, dot segments and empty', () => {
  for (const id of UNSAFE_IDS) {
    assert.strictEqual(lib.safeSessionId(id), null, `must reject ${JSON.stringify(id)}`);
  }
  assert.strictEqual(lib.safeSessionId('a b'), null);
  assert.strictEqual(lib.safeSessionId('a\0b'), null);
});

test('safeSessionId: rejects non-strings', () => {
  for (const v of [undefined, null, 42, {}, [], true]) {
    assert.strictEqual(lib.safeSessionId(v), null);
  }
});

// ---------------------------------------------------------------------------
// Path helpers and read/write helpers
// ---------------------------------------------------------------------------
test('path helpers: return null for unsafe ids, a state path for safe ids', () => {
  const state = path.join(os.homedir(), '.claude', 'state');
  assert.strictEqual(lib.counterPath(UUID), path.join(state, `delegations-${UUID}.jsonl`));
  assert.strictEqual(lib.sessionStartPath(UUID), path.join(state, `session-start-${UUID}`));
  assert.strictEqual(lib.sessionEffortPath(UUID), path.join(state, `session-effort-${UUID}.json`));
  for (const id of UNSAFE_IDS) {
    assert.strictEqual(lib.counterPath(id), null);
    assert.strictEqual(lib.sessionStartPath(id), null);
    assert.strictEqual(lib.sessionEffortPath(id), null);
  }
});

// Build a sandbox where HOME is nested, so an escape from $HOME/.claude/state
// in any direction lands somewhere the walk below can see.
function mkSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-sid-'));
  const home = path.join(root, 'a', 'home');
  fs.mkdirSync(path.join(home, '.claude', 'state'), { recursive: true });
  return { root, home };
}

// Every file and directory under root, relative, sorted.
function walk(root) {
  const out = [];
  const rec = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      out.push(path.relative(root, full) + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory()) rec(full);
    }
  };
  rec(root);
  return out.sort();
}

function baseline() {
  return ['a', 'a/home', 'a/home/.claude', 'a/home/.claude/state']
    .map((p) => path.join(...p.split('/')) + '/')
    .sort();
}

test('read/write helpers: unsafe ids write nothing and read nothing', () => {
  const { root, home } = mkSandbox();
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    for (const id of UNSAFE_IDS) {
      assert.doesNotThrow(() => lib.counterAppend(id, { id: 't', status: 'running' }));
      assert.strictEqual(lib.writeSessionEffort(id, 'high', '2.1.300'), false);
      assert.deepStrictEqual(lib.readCounters(id), { running: 0, done: 0, failed: 0, oldestStarted: null });
      assert.strictEqual(lib.findToolUseIdByAgentId(id, 'agent'), null);
      assert.strictEqual(lib.readSessionEffort(id), null);
    }
    assert.deepStrictEqual(walk(root), baseline());
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Integration: scripts never touch the filesystem for an unsafe id
// ---------------------------------------------------------------------------
const STATUSLINE = path.join(REPO_ROOT, 'scripts', 'statusline.js');
const SUBAGENT = path.join(REPO_ROOT, 'scripts', 'subagent-statusline.js');
const PRE = path.join(REPO_ROOT, 'scripts', 'track-delegation-pre.js');
const POST = path.join(REPO_ROOT, 'scripts', 'track-delegation-post.js');
const FAIL = path.join(REPO_ROOT, 'scripts', 'track-delegation-fail.js');
const STOP = path.join(REPO_ROOT, 'scripts', 'track-subagent-stop.js');

function runSandboxed(script, payload) {
  const { root, home } = mkSandbox();
  try {
    const r = runScript(script, JSON.stringify(payload), {
      HOME: home,
      USERPROFILE: home,
      CLAUDE_PLUGIN_DATA: path.join(home, '.claude', 'state', 'histdata'),
    });
    return Object.assign(r, { tree: walk(root) });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const id of ['../x', 'a/b', '../../evil']) {
  const label = JSON.stringify(id);

  test(`statusline: session_id ${label} exits 0, renders, writes no file`, () => {
    const r = runSandboxed(STATUSLINE, {
      session_id: id,
      version: '2.1.300',
      model: { id: 'claude-opus-4-7' },
      effort: { level: 'high' },
      workspace: { current_dir: '/w/proj' },
      context_window: { used_percentage: 12 },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /Opus 4\.7/);
    assert.deepStrictEqual(r.tree, baseline());
  });

  test(`subagent-statusline: session_id ${label} exits 0 and writes no file`, () => {
    const r = runSandboxed(SUBAGENT, {
      session_id: id,
      columns: 120,
      tasks: [{ id: 't1', model: 'claude-sonnet-4-6', description: 'x' }],
    });
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(r.tree, baseline());
  });

  for (const [name, script, extra] of [
    ['track-delegation-pre', PRE, { tool_input: { subagent_type: 'g', description: 'd', prompt: 'p' } }],
    ['track-delegation-post', POST, { tool_response: {} }],
    ['track-delegation-fail', FAIL, {}],
    ['track-subagent-stop', STOP, { agent_id: 'agent-1' }],
  ]) {
    test(`${name}: session_id ${label} exits 0 and writes no file`, () => {
      const r = runSandboxed(script, Object.assign({ session_id: id, tool_use_id: 'toolu_1' }, extra));
      assert.strictEqual(r.status, 0);
      assert.deepStrictEqual(r.tree, baseline());
    });
  }
}

test('track-delegation-pre: a UUID session_id still writes its counter file', () => {
  const r = runSandboxed(PRE, {
    session_id: UUID,
    tool_use_id: 'toolu_1',
    tool_input: { subagent_type: 'g', description: 'd', prompt: 'p' },
  });
  assert.strictEqual(r.status, 0);
  assert.ok(r.tree.includes(path.join('a', 'home', '.claude', 'state', `delegations-${UUID}.jsonl`)));
});
