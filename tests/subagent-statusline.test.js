// tests/subagent-statusline.test.js — per-subagent statusline renderer
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, runScript } = require('./_helpers');
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
