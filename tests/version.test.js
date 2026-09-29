// tests/version.test.js — numeric Claude Code version comparison
const test = require('node:test');
const assert = require('node:assert/strict');

const { versionAtLeast } = require('../scripts/lib/version');

test('version: equal and greater versions pass the gate', () => {
  assert.strictEqual(versionAtLeast('2.1.214', '2.1.214'), true);
  assert.strictEqual(versionAtLeast('2.1.285', '2.1.214'), true);
  assert.strictEqual(versionAtLeast('2.2.0', '2.1.214'), true);
  assert.strictEqual(versionAtLeast('3.0.0', '2.1.214'), true);
});

test('version: lower versions fail the gate, compared numerically', () => {
  assert.strictEqual(versionAtLeast('2.1.213', '2.1.214'), false);
  // Lexically "2.1.99" > "2.1.214"; numerically it is lower.
  assert.strictEqual(versionAtLeast('2.1.99', '2.1.214'), false);
  assert.strictEqual(versionAtLeast('2.0.999', '2.1.214'), false);
  assert.strictEqual(versionAtLeast('1.9.9', '2.1.214'), false);
});

test('version: tolerates pre-release and build suffixes', () => {
  assert.strictEqual(versionAtLeast('2.1.285-beta.1', '2.1.214'), true);
  assert.strictEqual(versionAtLeast('2.1.285 (Claude Code)', '2.1.214'), true);
});

test('version: unparseable or missing versions fail the gate', () => {
  for (const v of [null, undefined, '', 'garbage', '2.1', 42, {}, 'v2.1.285']) {
    assert.strictEqual(versionAtLeast(v, '2.1.214'), false, `${JSON.stringify(v)} must fail`);
  }
});
