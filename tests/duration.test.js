// tests/duration.test.js — shared elapsed-duration formatter
const test = require('node:test');
const assert = require('node:assert/strict');

const { formatDuration } = require('../scripts/lib/duration');

test('duration: renders seconds below one minute', () => {
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(1), '1s');
  assert.strictEqual(formatDuration(59), '59s');
});

test('duration: renders minutes and seconds below one hour', () => {
  assert.strictEqual(formatDuration(60), '1m 0s');
  assert.strictEqual(formatDuration(90), '1m 30s');
  assert.strictEqual(formatDuration(3599), '59m 59s');
});

test('duration: renders hours and minutes from one hour up', () => {
  assert.strictEqual(formatDuration(3600), '1h 0m');
  assert.strictEqual(formatDuration(7325), '2h 2m');
  assert.strictEqual(formatDuration(86399), '23h 59m');
});

test('duration: floors fractional seconds', () => {
  // The main statusline applied Math.floor before formatting; keep that so a
  // float never leaks into the output as "1m 30.7s".
  assert.strictEqual(formatDuration(90.7), '1m 30s');
  assert.strictEqual(formatDuration(0.9), '0s');
});

test('duration: clamps negative input to zero', () => {
  // Clock skew between the payload timestamp and local time must not render
  // as a negative duration.
  assert.strictEqual(formatDuration(-5), '0s');
});

test('duration: returns null for values that are not finite numbers', () => {
  assert.strictEqual(formatDuration(null), null);
  assert.strictEqual(formatDuration(undefined), null);
  assert.strictEqual(formatDuration('60'), null);
  assert.strictEqual(formatDuration(NaN), null);
  assert.strictEqual(formatDuration(Infinity), null);
});
