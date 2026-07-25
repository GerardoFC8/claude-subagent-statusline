// tests/width.test.js — visible-width measurement and safe truncation
const test = require('node:test');
const assert = require('node:assert/strict');

const { visibleWidth, truncateToWidth } = require('../scripts/lib/width');

// ---------------------------------------------------------------------------
// visibleWidth
// ---------------------------------------------------------------------------

test('width: counts plain ASCII one column per character', () => {
  assert.strictEqual(visibleWidth('Opus 4.8'), 8);
  assert.strictEqual(visibleWidth(''), 0);
});

test('width: ignores ANSI escape sequences', () => {
  assert.strictEqual(visibleWidth('\x1b[1m\x1b[36mOpus 4.8\x1b[0m'), 8);
});

test('width: counts the box-drawing characters this plugin renders as one column', () => {
  // The bar cells and separators must stay single-width or every budget breaks.
  assert.strictEqual(visibleWidth('█░'), 2);
  assert.strictEqual(visibleWidth('▁▂▃▄▅▆▇█'), 8);
  assert.strictEqual(visibleWidth(' · '), 3);
  assert.strictEqual(visibleWidth('…'), 1);
  assert.strictEqual(visibleWidth('⋯'), 1);
});

test('width: counts CJK characters as two columns', () => {
  assert.strictEqual(visibleWidth('日本語'), 6);
  assert.strictEqual(visibleWidth('한국어'), 6);
  assert.strictEqual(visibleWidth('中'), 2);
});

test('width: counts emoji as two columns, not as two code units', () => {
  // '🚀'.length === 2 in UTF-16 but it renders as two columns, so the count
  // happens to match; '🚀🚀' must be 4, not 2.
  assert.strictEqual(visibleWidth('🚀'), 2);
  assert.strictEqual(visibleWidth('🚀🚀'), 4);
});

test('width: returns 0 for non-string input', () => {
  assert.strictEqual(visibleWidth(null), 0);
  assert.strictEqual(visibleWidth(undefined), 0);
  assert.strictEqual(visibleWidth(42), 0);
});

// ---------------------------------------------------------------------------
// truncateToWidth
// ---------------------------------------------------------------------------

test('width: leaves a string that already fits untouched', () => {
  assert.strictEqual(truncateToWidth('short', 10), 'short');
  assert.strictEqual(truncateToWidth('exactly10!', 10), 'exactly10!');
});

test('width: truncates ASCII with an ellipsis inside the budget', () => {
  const out = truncateToWidth('abcdefghij', 5);
  assert.strictEqual(out, 'abcd…');
  assert.strictEqual(visibleWidth(out), 5);
});

test('width: never splits a surrogate pair', () => {
  // '🚀'.slice(0, 1) would yield a lone surrogate rendering as '�'.
  const out = truncateToWidth('🚀🚀🚀🚀🚀', 5);
  assert.ok(!/[\uD800-\uDFFF]/.test(out.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')), `lone surrogate in ${JSON.stringify(out)}`);
  assert.ok(visibleWidth(out) <= 5, `width ${visibleWidth(out)} exceeds 5`);
});

test('width: budgets wide characters by their rendered width', () => {
  // Six CJK characters are 12 columns; a budget of 7 fits three plus the ellipsis.
  const out = truncateToWidth('日本語のテキスト', 7);
  assert.ok(visibleWidth(out) <= 7, `width ${visibleWidth(out)} exceeds 7`);
  assert.ok(out.endsWith('…'), out);
});

test('width: returns an empty string for a budget that cannot hold anything', () => {
  assert.strictEqual(truncateToWidth('abcdef', 0), '');
  assert.strictEqual(truncateToWidth('abcdef', -3), '');
});

test('width: a budget of exactly one renders the ellipsis alone', () => {
  assert.strictEqual(truncateToWidth('abcdef', 1), '…');
});
