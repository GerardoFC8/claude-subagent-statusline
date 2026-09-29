// tests/subagent-statusline.test.js — per-subagent statusline renderer
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  REPO_ROOT,
  runScript,
  mkTmpHome,
  cleanupTmpHome,
  sessionEffortFile,
  counterFile,
} = require('./_helpers');
const { visibleWidth } = require('../scripts/lib/width');

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

test('subagent-statusline: resolves Bedrock-style model ids', () => {
  const payload = {
    columns: 200,
    tasks: [
      { id: 'a', model: 'us.anthropic.claude-sonnet-5-v1:0' },
      { id: 'b', model: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0' },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  assert.strictEqual(r.status, 0);
  const out = rows(r.stdout);
  assert.strictEqual(out.length, 2);
  // Exact equality on purpose: startsWith('Sonnet 5') would also accept the
  // "Sonnet 5.v1" regression, where the revision leaks into the version.
  assert.strictEqual(plain(out[0].content), 'Sonnet 5');
  assert.strictEqual(plain(out[1].content), 'Sonnet 3.5');
});

test('subagent-statusline: non-Claude model ids fall back to ⋯ instead of a guess', () => {
  // The parser must not manufacture a label from an unrelated id — "gpt-4o-mini"
  // rendering as "Gpt 4o.mini" would be worse than showing nothing.
  const payload = {
    columns: 80,
    tasks: [
      { id: 'a', model: 'gpt-4o-mini' },
      { id: 'b', model: 'some-custom-model' },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const out = rows(r.stdout);
  assert.strictEqual(out.length, 2);
  for (const row of out) {
    assert.ok(plain(row.content).startsWith('⋯'), `expected ⋯ fallback, got: ${plain(row.content)}`);
  }
});

// ---------------------------------------------------------------------------
// internal task types / elapsed
// ---------------------------------------------------------------------------

test('subagent-statusline: suppresses the internal local_agent task type', () => {
  // Claude Code sends `type: "local_agent"` for every sub-agent, so rendering it
  // costs width and tells the user nothing. The real agent name comes from the
  // delegation hooks instead (see the agent-name tests below); with no session
  // counter file there is nothing to recover and the type is simply omitted.
  const payload = {
    columns: 200,
    tasks: [{ id: 'a', model: 'claude-haiku-4-5', type: 'local_agent', description: 'count files' }],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const visible = plain(rows(r.stdout)[0].content);
  assert.ok(!visible.includes('local_agent'), `internal type leaked: ${visible}`);
  assert.strictEqual(visible, 'Haiku 4.5 · count files');
});

test('subagent-statusline: keeps a task type that is not an internal placeholder', () => {
  const payload = {
    columns: 200,
    tasks: [{ id: 'a', model: 'claude-haiku-4-5', type: 'Explore', description: 'count files' }],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  assert.strictEqual(plain(rows(r.stdout)[0].content), 'Haiku 4.5 · Explore · count files');
});

// ---------------------------------------------------------------------------
// agent name recovered from the delegation hooks' counter file
// ---------------------------------------------------------------------------

// Run the renderer with an isolated HOME whose session counter file holds
// `lines` (skipped when undefined). Returns the visible rows.
function runWithDelegations(tasks, lines, opts) {
  const home = mkTmpHome();
  const sid = 'SESS_NAMES';
  try {
    if (lines !== undefined) {
      fs.writeFileSync(counterFile(home, sid), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    }
    const payload = { session_id: sid, columns: (opts && opts.columns) || 200, tasks };
    const r = runScript(SCRIPT, JSON.stringify(payload), { HOME: home, USERPROFILE: home });
    assert.strictEqual(r.status, 0);
    return rows(r.stdout).map((x) => plain(x.content));
  } finally {
    cleanupTmpHome(home);
  }
}

// A payload task as Claude Code sends it: `id` is the agent id, `type` is the
// internal placeholder.
const liveTask = (id, description) => ({
  id,
  type: 'local_agent',
  model: 'claude-haiku-4-5',
  description,
  label: description,
});

test('subagent-statusline: names a background agent by its exact agent_id', () => {
  const out = runWithDelegations([liveTask('a558e1f456c3a8813', 'map the repo')], [
    { id: 'toolu_1', type: 'Explore', desc: 'map the repo', status: 'running', background: true },
    { id: 'toolu_1', agent_id: 'a558e1f456c3a8813', status: 'bg_launched' },
  ]);
  assert.deepStrictEqual(out, ['Haiku 4.5 · Explore · map the repo']);
});

test('subagent-statusline: the exact agent_id match wins over an ambiguous description', () => {
  const out = runWithDelegations([liveTask('agent_bg', 'same words')], [
    { id: 'toolu_1', type: 'Explore', desc: 'same words', status: 'running', background: true },
    { id: 'toolu_1', agent_id: 'agent_bg', status: 'bg_launched' },
    { id: 'toolu_2', type: 'sdd-apply', desc: 'same words', status: 'running' },
  ]);
  assert.deepStrictEqual(out, ['Haiku 4.5 · Explore · same words']);
});

test('subagent-statusline: names a foreground agent by its exact description', () => {
  // Foreground agents have no agent_id line until they finish.
  const out = runWithDelegations([liveTask('agent_fg', 'count files')], [
    { id: 'toolu_1', type: 'sdd-apply', desc: 'count files', status: 'running' },
    { id: 'toolu_2', type: 'Plan', desc: 'count files and more', status: 'running' },
  ]);
  assert.deepStrictEqual(out, ['Haiku 4.5 · sdd-apply · count files']);
});

test('subagent-statusline: several running matches of one type still resolve', () => {
  const out = runWithDelegations([liveTask('agent_fg', 'count files')], [
    { id: 'toolu_1', type: 'Explore', desc: 'count files', status: 'running' },
    { id: 'toolu_2', type: 'Explore', desc: 'count files', status: 'running' },
  ]);
  assert.deepStrictEqual(out, ['Haiku 4.5 · Explore · count files']);
});

test('subagent-statusline: an ambiguous description renders no name rather than a guess', () => {
  const out = runWithDelegations([liveTask('agent_fg', 'count files')], [
    { id: 'toolu_1', type: 'Explore', desc: 'count files', status: 'running' },
    { id: 'toolu_2', type: 'sdd-apply', desc: 'count files', status: 'running' },
  ]);
  assert.deepStrictEqual(out, ['Haiku 4.5 · count files']);
});

test('subagent-statusline: an omitted type differing from another match is ambiguous', () => {
  const out = runWithDelegations([liveTask('agent_fg', 'count files')], [
    { id: 'toolu_1', type: 'Explore', desc: 'count files', status: 'running' },
    { id: 'toolu_2', type: '', desc: 'count files', status: 'running' },
  ]);
  assert.deepStrictEqual(out, ['Haiku 4.5 · count files']);
});

test('subagent-statusline: an omitted type agrees with an explicit general-purpose', () => {
  const out = runWithDelegations([liveTask('agent_fg', 'count files')], [
    { id: 'toolu_1', type: 'general-purpose', desc: 'count files', status: 'running' },
    { id: 'toolu_2', type: '', desc: 'count files', status: 'running' },
  ]);
  assert.deepStrictEqual(out, ['Haiku 4.5 · general-purpose · count files']);
});

test('subagent-statusline: an omitted type renders general-purpose', () => {
  const out = runWithDelegations([liveTask('agent_bg', 'bg work'), liveTask('agent_fg', 'fg work')], [
    { id: 'toolu_1', type: '', desc: 'bg work', status: 'running', background: true },
    { id: 'toolu_1', agent_id: 'agent_bg', status: 'bg_launched' },
    { id: 'toolu_2', desc: 'fg work', status: 'running' },
  ]);
  assert.deepStrictEqual(out, [
    'Haiku 4.5 · general-purpose · bg work',
    'Haiku 4.5 · general-purpose · fg work',
  ]);
});

test('subagent-statusline: a background agent_id match does not make a foreground description ambiguous', () => {
  const out = runWithDelegations([liveTask('agent_bg', 'review code'), liveTask('agent_fg', 'review code')], [
    { id: 'toolu_1', type: 'Explore', desc: 'review code', status: 'running', background: true },
    { id: 'toolu_1', agent_id: 'agent_bg', status: 'bg_launched' },
    { id: 'toolu_2', type: 'sdd-verify', desc: 'review code', status: 'running' },
  ]);
  assert.deepStrictEqual(out, [
    'Haiku 4.5 · Explore · review code',
    'Haiku 4.5 · sdd-verify · review code',
  ]);
});

test('subagent-statusline: the description match ignores finished delegations', () => {
  const out = runWithDelegations([liveTask('agent_fg', 'count files')], [
    { id: 'toolu_1', type: 'Explore', desc: 'count files', status: 'running' },
    { id: 'toolu_1', ended: '2026-09-29T00:01:00Z', status: 'done' },
    { id: 'toolu_2', type: 'Plan', desc: 'count files', status: 'running' },
    { id: 'toolu_2', ended: '2026-09-29T00:01:00Z', status: 'failed' },
  ]);
  assert.deepStrictEqual(out, ['Haiku 4.5 · count files']);
});

test('subagent-statusline: a non-internal payload type wins over the counter file', () => {
  const out = runWithDelegations(
    [{ ...liveTask('agent_bg', 'map the repo'), type: 'general-purpose' }],
    [
      { id: 'toolu_1', type: 'Explore', desc: 'map the repo', status: 'running' },
      { id: 'toolu_1', agent_id: 'agent_bg', status: 'bg_launched' },
    ],
  );
  assert.deepStrictEqual(out, ['Haiku 4.5 · general-purpose · map the repo']);
});

test('subagent-statusline: a missing counter file renders no name and does not fail', () => {
  const out = runWithDelegations([liveTask('agent_fg', 'count files')], undefined);
  assert.deepStrictEqual(out, ['Haiku 4.5 · count files']);
});

test('subagent-statusline: renders elapsed time from startTime', () => {
  // Offset chosen so a second of drift between building the payload and running
  // the script cannot change the rendered label.
  const payload = {
    columns: 200,
    tasks: [{ id: 'a', model: 'claude-haiku-4-5', description: 'work', startTime: Date.now() - 7325000 }],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  assert.strictEqual(plain(rows(r.stdout)[0].content), 'Haiku 4.5 · work · 2h 2m');
});

test('subagent-statusline: renders elapsed alongside the context usage', () => {
  const payload = {
    columns: 200,
    tasks: [
      {
        id: 'a',
        model: 'claude-haiku-4-5',
        description: 'work',
        startTime: Date.now() - 7325000,
        tokenCount: 50000,
        contextWindowSize: 200000,
      },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  assert.strictEqual(
    plain(rows(r.stdout)[0].content),
    'Haiku 4.5 · work ████░░░░░░░░░░░░ 50k/200k · 2h 2m',
  );
});

test('subagent-statusline: omits elapsed when startTime is missing or unusable', () => {
  const payload = {
    columns: 200,
    tasks: [
      { id: 'a', model: 'claude-haiku-4-5', description: 'work' },
      { id: 'b', model: 'claude-haiku-4-5', description: 'work', startTime: 'yesterday' },
      { id: 'c', model: 'claude-haiku-4-5', description: 'work', startTime: null },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const out = rows(r.stdout);
  assert.strictEqual(out.length, 3);
  for (const row of out) {
    assert.strictEqual(plain(row.content), 'Haiku 4.5 · work');
  }
});

test('subagent-statusline: elapsed counts against the description budget', () => {
  const columns = 60;
  const payload = {
    columns,
    tasks: [
      {
        id: 'a',
        model: 'claude-opus-4-8',
        description: 'z'.repeat(300),
        startTime: Date.now() - 7325000,
        tokenCount: 50000,
        contextWindowSize: 200000,
      },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const visible = plain(rows(r.stdout)[0].content);
  assert.ok(visible.includes('2h 2m'), visible);
  assert.ok(visible.length <= columns, `row of ${visible.length} exceeds columns=${columns}: ${visible}`);
});

// ---------------------------------------------------------------------------
// effort level (parity with the main statusline, which has shown it since v0.9.0)
// ---------------------------------------------------------------------------

test('subagent-statusline: renders the effort level after the model', () => {
  const payload = {
    columns: 200,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', effort: 'xhigh', type: 'sdd-apply' },
      { id: 'b', model: 'claude-haiku-4-5', effort: 'low', type: 'sdd-archive' },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  assert.strictEqual(r.status, 0);
  const out = rows(r.stdout);
  assert.ok(plain(out[0].content).startsWith('Opus 4.8 (xhigh) · sdd-apply'), plain(out[0].content));
  assert.ok(plain(out[1].content).startsWith('Haiku 4.5 (low) · sdd-archive'), plain(out[1].content));
});

test('subagent-statusline: accepts the object effort shape used by the main payload', () => {
  const payload = {
    columns: 200,
    tasks: [{ id: 'a', model: 'claude-sonnet-5', effort: { level: 'high' } }],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  assert.strictEqual(plain(rows(r.stdout)[0].content), 'Sonnet 5 (high)');
});

test('subagent-statusline: omits effort when absent or unusable', () => {
  const payload = {
    columns: 200,
    tasks: [
      { id: 'a', model: 'claude-sonnet-5' }, // absent
      { id: 'b', model: 'claude-sonnet-5', effort: '' }, // empty
      { id: 'c', model: 'claude-sonnet-5', effort: -1 }, // negative budget
      { id: 'd', model: 'claude-sonnet-5', effort: {} }, // object without level
      { id: 'e', model: 'claude-sonnet-5', effort: 0 }, // zero budget is meaningless
      { id: 'f', model: 'claude-sonnet-5', effort: true }, // wrong type
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const out = rows(r.stdout);
  assert.strictEqual(out.length, 6);
  for (const row of out) {
    assert.strictEqual(plain(row.content), 'Sonnet 5', `unexpected effort: ${plain(row.content)}`);
  }
});

test('subagent-statusline: effort counts against the description budget', () => {
  // The effort suffix must be part of the fixed width, or a long description
  // would push the row past `columns`.
  const columns = 60;
  const payload = {
    columns,
    tasks: [
      {
        id: 'a',
        model: 'claude-opus-4-8',
        effort: 'xhigh',
        type: 'general-purpose',
        description: 'z'.repeat(300),
        tokenCount: 50000,
        contextWindowSize: 200000,
      },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const visible = plain(rows(r.stdout)[0].content);
  assert.ok(visible.includes('(xhigh)'), visible);
  assert.ok(visible.length <= columns, `row of ${visible.length} exceeds columns=${columns}: ${visible}`);
});

// ---------------------------------------------------------------------------
// numeric effort (token budget) and effort inherited from the session
// ---------------------------------------------------------------------------

test('subagent-statusline: renders a numeric effort as a compact token budget', () => {
  const payload = {
    columns: 200,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', effort: 32000 },
      { id: 'b', model: 'claude-opus-4-8', effort: 42 },
      { id: 'c', model: 'claude-opus-4-8', effort: 1500000 },
      { id: 'd', model: 'claude-opus-4-8', effort: { level: 16000 } },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  assert.strictEqual(r.status, 0);
  const out = rows(r.stdout).map((x) => plain(x.content));
  assert.deepStrictEqual(out, [
    'Opus 4.8 (32k)',
    'Opus 4.8 (42)',
    'Opus 4.8 (1.5M)',
    'Opus 4.8 (16k)',
  ]);
});

// Run the renderer with an isolated HOME holding (or not holding) a session
// effort file. `fileContent` is written verbatim when it is a string, as JSON
// otherwise, and skipped when undefined.
function runWithSessionEffort(tasks, fileContent, opts) {
  const home = mkTmpHome();
  const sid = (opts && opts.sid) || 'SESS_EFFORT';
  try {
    if (fileContent !== undefined) {
      fs.writeFileSync(
        sessionEffortFile(home, sid),
        typeof fileContent === 'string' ? fileContent : JSON.stringify(fileContent),
      );
    }
    const payload = { session_id: sid, columns: (opts && opts.columns) || 200, tasks };
    if (opts && opts.noSessionId) delete payload.session_id;
    const r = runScript(SCRIPT, JSON.stringify(payload), { HOME: home, USERPROFILE: home });
    assert.strictEqual(r.status, 0);
    return rows(r.stdout).map((x) => plain(x.content));
  } finally {
    cleanupTmpHome(home);
  }
}

test('subagent-statusline: absent effort inherits the session effort as (~level)', () => {
  const out = runWithSessionEffort(
    [{ id: 'a', model: 'claude-sonnet-5' }],
    { effort: 'medium', version: '2.1.285' },
  );
  assert.deepStrictEqual(out, ['Sonnet 5 (~medium)']);
});

test('subagent-statusline: inherited effort is shown at exactly the gate version', () => {
  const out = runWithSessionEffort(
    [{ id: 'a', model: 'claude-sonnet-5' }],
    { effort: 'high', version: '2.1.214' },
  );
  assert.deepStrictEqual(out, ['Sonnet 5 (~high)']);
});

test('subagent-statusline: explicit per-task effort wins over the session file', () => {
  const out = runWithSessionEffort(
    [
      { id: 'a', model: 'claude-sonnet-5', effort: 'low' },
      { id: 'b', model: 'claude-sonnet-5', effort: 8000 },
      { id: 'c', model: 'claude-sonnet-5' },
    ],
    { effort: 'max', version: '2.1.285' },
  );
  assert.deepStrictEqual(out, ['Sonnet 5 (low)', 'Sonnet 5 (8k)', 'Sonnet 5 (~max)']);
});

test('subagent-statusline: an explicit but unusable effort does not fall back to the session', () => {
  // Only a genuinely absent field means "inherits the session effort".
  const out = runWithSessionEffort(
    [
      { id: 'a', model: 'claude-sonnet-5', effort: '' },
      { id: 'b', model: 'claude-sonnet-5', effort: {} },
    ],
    { effort: 'max', version: '2.1.285' },
  );
  assert.deepStrictEqual(out, ['Sonnet 5', 'Sonnet 5']);
});

test('subagent-statusline: inherited effort is hidden on Claude Code older than 2.1.214', () => {
  // 2.1.99 would pass a lexical string comparison against 2.1.214; the gate
  // must compare numerically.
  for (const version of ['2.1.213', '2.1.99', '2.0.500', '1.9.999']) {
    const out = runWithSessionEffort(
      [{ id: 'a', model: 'claude-sonnet-5' }],
      { effort: 'medium', version },
    );
    assert.deepStrictEqual(out, ['Sonnet 5'], `version ${version} must not show inherited effort`);
  }
});

test('subagent-statusline: inherited effort is hidden when the version is missing or unparseable', () => {
  for (const version of [null, undefined, '', 'garbage', 42, '2.1']) {
    const out = runWithSessionEffort(
      [{ id: 'a', model: 'claude-sonnet-5' }],
      { effort: 'medium', version },
    );
    assert.deepStrictEqual(out, ['Sonnet 5'], `version ${JSON.stringify(version)} must not show`);
  }
});

test('subagent-statusline: no inherited effort when the session effort is null', () => {
  const out = runWithSessionEffort(
    [{ id: 'a', model: 'claude-sonnet-5' }],
    { effort: null, version: '2.1.285' },
  );
  assert.deepStrictEqual(out, ['Sonnet 5']);
});

test('subagent-statusline: missing or corrupt session effort file is ignored silently', () => {
  const task = [{ id: 'a', model: 'claude-sonnet-5' }];
  assert.deepStrictEqual(runWithSessionEffort(task, undefined), ['Sonnet 5']);
  assert.deepStrictEqual(runWithSessionEffort(task, '{ not json'), ['Sonnet 5']);
  assert.deepStrictEqual(runWithSessionEffort(task, '[1,2]'), ['Sonnet 5']);
  assert.deepStrictEqual(runWithSessionEffort(task, 'null'), ['Sonnet 5']);
});

test('subagent-statusline: no session_id means no inherited effort', () => {
  const out = runWithSessionEffort(
    [{ id: 'a', model: 'claude-sonnet-5' }],
    { effort: 'medium', version: '2.1.285' },
    { noSessionId: true },
  );
  assert.deepStrictEqual(out, ['Sonnet 5']);
});

test('subagent-statusline: inherited effort counts against the description budget', () => {
  const columns = 60;
  const out = runWithSessionEffort(
    [
      {
        id: 'a',
        model: 'claude-opus-4-8',
        type: 'general-purpose',
        description: 'z'.repeat(300),
        tokenCount: 50000,
        contextWindowSize: 200000,
      },
    ],
    { effort: 'xhigh', version: '2.1.285' },
    { columns },
  );
  assert.ok(out[0].includes('(~xhigh)'), out[0]);
  assert.ok(visibleWidth(out[0]) <= columns, `row of ${visibleWidth(out[0])} exceeds columns=${columns}: ${out[0]}`);
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

test('subagent-statusline: appends a context bar and the absolute usage, not a percentage', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 50000, contextWindowSize: 200000 },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const visible = plain(rows(r.stdout)[0].content);
  // 25% of a 16-cell bar is 4 filled cells.
  assert.strictEqual(visible, 'Opus 4.8 ████░░░░░░░░░░░░ 50k/200k');
  assert.ok(!/\d%/.test(visible), `percentage must be gone: ${visible}`);
});

test('subagent-statusline: abbreviates thousands and scales millions', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 842, contextWindowSize: 200000 },
      { id: 'b', model: 'claude-opus-4-8', tokenCount: 12022, contextWindowSize: 200000 },
      { id: 'c', model: 'claude-opus-4-8', tokenCount: 20000, contextWindowSize: 1000000 },
      { id: 'd', model: 'claude-opus-4-8', tokenCount: 1500000, contextWindowSize: 2000000 },
    ],
  };
  const out = rows(runScript(SCRIPT, JSON.stringify(payload)).stdout);
  assert.ok(plain(out[0].content).endsWith(' 842/200k'), plain(out[0].content));
  assert.ok(plain(out[1].content).endsWith(' 12k/200k'), plain(out[1].content));
  // A 1M window must not read as "1000k".
  assert.ok(plain(out[2].content).endsWith(' 20k/1M'), plain(out[2].content));
  assert.ok(plain(out[3].content).endsWith(' 1.5M/2M'), plain(out[3].content));
});

test('subagent-statusline: keeps the exact count below one thousand for fractional values', () => {
  // The threshold must test the raw value, not the rounded one, or 999.6 reads
  // as "1k" while being under a thousand.
  const payload = {
    columns: 120,
    tasks: [{ id: 'a', model: 'claude-opus-4-8', tokenCount: 999.6, contextWindowSize: 200000 }],
  };
  assert.ok(plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content).endsWith(' 999/200k'));
});

test('subagent-statusline: no context segment when contextWindowSize is zero or missing', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 5, contextWindowSize: 0 },
      { id: 'b', model: 'claude-opus-4-8', tokenCount: 5 },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  for (const row of rows(r.stdout)) {
    assert.strictEqual(plain(row.content), 'Opus 4.8');
  }
});

// ---------------------------------------------------------------------------
// context fill bar
// ---------------------------------------------------------------------------

test('subagent-statusline: the bar is a fixed width regardless of usage', () => {
  // A bar that changed width between ticks would make the row jump around.
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 0, contextWindowSize: 200000 },
      { id: 'b', model: 'claude-opus-4-8', tokenCount: 100000, contextWindowSize: 200000 },
      { id: 'c', model: 'claude-opus-4-8', tokenCount: 200000, contextWindowSize: 200000 },
    ],
  };
  for (const row of rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)) {
    const cells = plain(row.content).match(/[█░]+/)[0];
    assert.strictEqual(cells.length, 16, `bar of ${cells.length} cells: ${plain(row.content)}`);
  }
});

test('subagent-statusline: the bar tracks the share of the window consumed', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 0, contextWindowSize: 200000 },
      { id: 'b', model: 'claude-opus-4-8', tokenCount: 100000, contextWindowSize: 200000 },
      { id: 'c', model: 'claude-opus-4-8', tokenCount: 200000, contextWindowSize: 200000 },
    ],
  };
  const out = rows(runScript(SCRIPT, JSON.stringify(payload)).stdout);
  assert.ok(plain(out[0].content).includes('░░░░░░░░░░░░░░░░'), plain(out[0].content));
  assert.ok(plain(out[1].content).includes('████████░░░░░░░░'), plain(out[1].content));
  assert.ok(plain(out[2].content).includes('████████████████'), plain(out[2].content));
});

test('subagent-statusline: any consumption at all shows at least one filled cell', () => {
  // On a 1M window, 20k rounds to zero cells. Showing an empty bar for a
  // sub-agent that is actively consuming would be misleading.
  const payload = {
    columns: 120,
    tasks: [{ id: 'a', model: 'claude-opus-4-8', tokenCount: 20000, contextWindowSize: 1000000 }],
  };
  const visible = plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content);
  assert.ok(visible.includes('█░░░░░░░░░░░░░░░'), visible);
});

test('subagent-statusline: usage above the window clamps the bar instead of overflowing it', () => {
  const payload = {
    columns: 120,
    tasks: [{ id: 'a', model: 'claude-opus-4-8', tokenCount: 500000, contextWindowSize: 200000 }],
  };
  const visible = plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content);
  const cells = visible.match(/[█░]+/)[0];
  assert.strictEqual(cells, '████████████████');
  // The figure still tells the truth about being over the window.
  assert.ok(visible.endsWith('500k/200k'), visible);
});

test('subagent-statusline: the bar counts against the description budget', () => {
  const columns = 60;
  const payload = {
    columns,
    tasks: [
      {
        id: 'a',
        model: 'claude-opus-4-8',
        description: 'z'.repeat(300),
        tokenCount: 12022,
        contextWindowSize: 200000,
        startTime: Date.now() - 7325000,
      },
    ],
  };
  const visible = plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content);
  assert.ok(visibleWidth(visible) <= columns, `row of ${visibleWidth(visible)} exceeds columns=${columns}: ${visible}`);
});

// ---------------------------------------------------------------------------
// the row never exceeds `columns`
// ---------------------------------------------------------------------------

test('subagent-statusline: sheds optional segments so a narrow pane still fits', () => {
  // Truncating the description alone cannot honour `columns` once the fixed
  // segments exceed it on their own.
  const base = {
    model: 'claude-opus-4-8',
    effort: 'xhigh',
    type: 'general-purpose',
    description: 'a fairly long description that will not fit',
    tokenCount: 12022,
    contextWindowSize: 200000,
    startTime: Date.now() - 7325000,
  };
  for (const columns of [1, 2, 5, 10, 20, 30, 40, 55, 80, 120]) {
    const r = runScript(SCRIPT, JSON.stringify({ columns, tasks: [{ id: 'a', ...base }] }));
    assert.strictEqual(r.status, 0);
    const visible = plain(rows(r.stdout)[0].content);
    assert.ok(
      visibleWidth(visible) <= columns,
      `columns=${columns} produced width ${visibleWidth(visible)}: ${visible}`,
    );
  }
});

test('subagent-statusline: narrow panes shed the bar before the agent name', () => {
  // Fixed pieces: "Opus 4.8 (xhigh)" 16 + " · Explore" 10 + bar 17 + " 12k/200k" 9
  // + " · 2h 2m" 8 = 60 columns. At 50 dropping the bar alone is enough; the old
  // order dropped the name first and kept the bar.
  const task = {
    id: 'a',
    model: 'claude-opus-4-8',
    effort: 'xhigh',
    type: 'Explore',
    description: 'a fairly long description that will not fit',
    tokenCount: 12022,
    contextWindowSize: 200000,
    startTime: Date.now() - 7325000,
  };
  const at = (columns) =>
    plain(rows(runScript(SCRIPT, JSON.stringify({ columns, tasks: [task] })).stdout)[0].content);

  const wide = at(50);
  assert.ok(wide.includes('Explore'), `name must survive: ${wide}`);
  assert.ok(!/[█░]/.test(wide), `bar must be shed first: ${wide}`);
  assert.ok(wide.includes('12k/200k') && wide.includes('2h 2m'), wide);

  // Then the name goes, before elapsed and usage.
  const narrow = at(36);
  assert.strictEqual(narrow, 'Opus 4.8 (xhigh) 12k/200k · 2h 2m');

  // Then elapsed, before usage.
  assert.strictEqual(at(26), 'Opus 4.8 (xhigh) 12k/200k');
});

test('subagent-statusline: a wide-character description is budgeted by rendered width', () => {
  // Each CJK character occupies two columns while String.length reports one.
  const columns = 40;
  const payload = {
    columns,
    tasks: [
      {
        id: 'a',
        model: 'claude-opus-4-8',
        description: '日本語のテキストがとても長い場合はどうなるか',
        tokenCount: 12022,
        contextWindowSize: 200000,
      },
    ],
  };
  const visible = plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content);
  assert.ok(visibleWidth(visible) <= columns, `width ${visibleWidth(visible)}: ${visible}`);
});

test('subagent-statusline: truncation never splits an emoji into a broken glyph', () => {
  const payload = {
    columns: 40,
    tasks: [
      {
        id: 'a',
        model: 'claude-opus-4-8',
        description: '🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀',
        tokenCount: 12022,
        contextWindowSize: 200000,
      },
    ],
  };
  const visible = plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content);
  // Strip well-formed pairs; any surrogate left over is a severed half.
  const orphans = visible.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
  assert.ok(!/[\uD800-\uDFFF]/.test(orphans), `severed surrogate in: ${JSON.stringify(visible)}`);
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
