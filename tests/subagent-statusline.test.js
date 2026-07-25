// tests/subagent-statusline.test.js — per-subagent statusline renderer
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, runScript } = require('./_helpers');

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
  // Claude Code sends `type: "local_agent"` for every foreground sub-agent, so
  // rendering it costs width and tells the user nothing. Verified against a real
  // captured payload: the requested agent type is not exposed in any field.
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
  assert.strictEqual(plain(rows(r.stdout)[0].content), 'Haiku 4.5 · work 50k/200k · 2h 2m');
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
      { id: 'c', model: 'claude-sonnet-5', effort: 42 }, // non-string
      { id: 'd', model: 'claude-sonnet-5', effort: {} }, // object without level
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const out = rows(r.stdout);
  assert.strictEqual(out.length, 4);
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

test('subagent-statusline: appends context usage as used/window, not a percentage', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 50000, contextWindowSize: 200000 },
    ],
  };
  const r = runScript(SCRIPT, JSON.stringify(payload));
  const visible = plain(rows(r.stdout)[0].content);
  assert.strictEqual(visible, 'Opus 4.8 50k/200k');
  assert.ok(!/\d%/.test(visible), `percentage must be gone: ${visible}`);
});

test('subagent-statusline: abbreviates thousands and keeps small counts exact', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 842, contextWindowSize: 200000 },
      { id: 'b', model: 'claude-opus-4-8', tokenCount: 0, contextWindowSize: 200000 },
      { id: 'c', model: 'claude-opus-4-8', tokenCount: 12022, contextWindowSize: 200000 },
      { id: 'd', model: 'claude-opus-4-8', tokenCount: 1000000, contextWindowSize: 1000000 },
    ],
  };
  const out = rows(runScript(SCRIPT, JSON.stringify(payload)).stdout);
  assert.strictEqual(plain(out[0].content), 'Opus 4.8 842/200k');
  assert.strictEqual(plain(out[1].content), 'Opus 4.8 0/200k');
  assert.strictEqual(plain(out[2].content), 'Opus 4.8 12k/200k');
  assert.strictEqual(plain(out[3].content), 'Opus 4.8 1000k/1000k');
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
// tokenSamples sparkline
// ---------------------------------------------------------------------------

test('subagent-statusline: renders a sparkline from tokenSamples', () => {
  const payload = {
    columns: 120,
    tasks: [
      {
        id: 'a',
        model: 'claude-opus-4-8',
        tokenCount: 12022,
        contextWindowSize: 200000,
        tokenSamples: [0, 12012, 12022],
      },
    ],
  };
  const visible = plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content);
  assert.ok(/[▁▂▃▄▅▆▇█]{3}/.test(visible), `expected a 3-cell sparkline, got: ${visible}`);
  assert.ok(visible.endsWith('12k/200k'), visible);
});

test('subagent-statusline: a flat sample series renders a flat sparkline', () => {
  // This is the stall signal: a sub-agent that stopped consuming tokens shows a
  // level line instead of a rising one.
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 900, contextWindowSize: 200000, tokenSamples: [900, 900, 900, 900] },
    ],
  };
  const visible = plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content);
  assert.ok(visible.includes('▁▁▁▁'), `expected a flat sparkline, got: ${visible}`);
});

test('subagent-statusline: a rising series ends higher than it starts', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 80, contextWindowSize: 200000, tokenSamples: [0, 40, 80] },
    ],
  };
  const visible = plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content);
  const spark = visible.match(/[▁▂▃▄▅▆▇█]+/)[0];
  const cells = '▁▂▃▄▅▆▇█';
  assert.strictEqual(spark.length, 3);
  assert.ok(
    cells.indexOf(spark[2]) > cells.indexOf(spark[0]),
    `expected a rising sparkline, got: ${spark}`,
  );
});

test('subagent-statusline: caps the sparkline so an unbounded series cannot grow the row', () => {
  // tokenSamples accumulates one entry per tick and never shrinks, so the row
  // would widen forever without a cap.
  const samples = Array.from({ length: 200 }, (_, i) => i * 100);
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 19900, contextWindowSize: 200000, tokenSamples: samples },
    ],
  };
  const visible = plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content);
  const spark = visible.match(/[▁▂▃▄▅▆▇█]+/)[0];
  assert.ok(spark.length <= 8, `sparkline of ${spark.length} cells is uncapped: ${spark}`);
});

test('subagent-statusline: omits the sparkline for fewer than two samples', () => {
  const payload = {
    columns: 120,
    tasks: [
      { id: 'a', model: 'claude-opus-4-8', tokenCount: 5, contextWindowSize: 200000, tokenSamples: [5] },
      { id: 'b', model: 'claude-opus-4-8', tokenCount: 5, contextWindowSize: 200000, tokenSamples: [] },
      { id: 'c', model: 'claude-opus-4-8', tokenCount: 5, contextWindowSize: 200000 },
      { id: 'd', model: 'claude-opus-4-8', tokenCount: 5, contextWindowSize: 200000, tokenSamples: 'nope' },
    ],
  };
  for (const row of rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)) {
    const visible = plain(row.content);
    assert.ok(!/[▁▂▃▄▅▆▇█]/.test(visible), `unexpected sparkline: ${visible}`);
    assert.strictEqual(visible, 'Opus 4.8 5/200k');
  }
});

test('subagent-statusline: the sparkline counts against the description budget', () => {
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
        tokenSamples: [0, 4000, 8000, 12022],
        startTime: Date.now() - 7325000,
      },
    ],
  };
  const visible = plain(rows(runScript(SCRIPT, JSON.stringify(payload)).stdout)[0].content);
  assert.ok(/[▁▂▃▄▅▆▇█]/.test(visible), visible);
  assert.ok(visible.length <= columns, `row of ${visible.length} exceeds columns=${columns}: ${visible}`);
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
