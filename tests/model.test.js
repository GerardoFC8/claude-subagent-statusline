// tests/model.test.js — shared model-id parser
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseModelFromId } = require('../scripts/lib/model');

// ---------------------------------------------------------------------------
// first-party model ids
// ---------------------------------------------------------------------------

test('model: parses plain family-version ids', () => {
  assert.strictEqual(parseModelFromId('claude-opus-4-8'), 'Opus 4.8');
  assert.strictEqual(parseModelFromId('claude-sonnet-4-6'), 'Sonnet 4.6');
  assert.strictEqual(parseModelFromId('claude-haiku-4-5'), 'Haiku 4.5');
  assert.strictEqual(parseModelFromId('claude-sonnet-5'), 'Sonnet 5');
  assert.strictEqual(parseModelFromId('claude-fable-5'), 'Fable 5');
});

test('model: strips bracketed context-window suffixes', () => {
  assert.strictEqual(parseModelFromId('claude-opus-4-8[1m]'), 'Opus 4.8');
  assert.strictEqual(parseModelFromId('claude-opus-5[1m]'), 'Opus 5');
});

test('model: strips trailing date snapshots', () => {
  assert.strictEqual(parseModelFromId('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.strictEqual(parseModelFromId('claude-opus-4-1@20250805'), 'Opus 4.1');
});

test('model: returns family alone when the id carries no version', () => {
  assert.strictEqual(parseModelFromId('claude-opus'), 'Opus');
});

// ---------------------------------------------------------------------------
// Bedrock / Vertex style ids
// ---------------------------------------------------------------------------

test('model: parses Bedrock ids with a revision suffix', () => {
  assert.strictEqual(parseModelFromId('us.anthropic.claude-sonnet-5-v1:0'), 'Sonnet 5');
  assert.strictEqual(parseModelFromId('eu.anthropic.claude-opus-4-8-v2:0'), 'Opus 4.8');
});

test('model: parses legacy Bedrock ids where the family follows the version', () => {
  assert.strictEqual(
    parseModelFromId('us.anthropic.claude-3-5-sonnet-20240620-v1:0'),
    'Sonnet 3.5',
  );
  assert.strictEqual(parseModelFromId('anthropic.claude-3-opus-20240229-v1:0'), 'Opus 3');
});

// ---------------------------------------------------------------------------
// guard: never invent a model name from a non-Claude id
// ---------------------------------------------------------------------------

test('model: returns null for ids that are not Claude models', () => {
  assert.strictEqual(parseModelFromId('some-custom-model'), null);
  assert.strictEqual(parseModelFromId('gpt-4o-mini'), null);
  assert.strictEqual(parseModelFromId('llama-3-70b-instruct'), null);
});

test('model: returns null for degenerate or non-string ids', () => {
  assert.strictEqual(parseModelFromId('claude-'), null);
  assert.strictEqual(parseModelFromId(''), null);
  assert.strictEqual(parseModelFromId('   '), null);
  assert.strictEqual(parseModelFromId(null), null);
  assert.strictEqual(parseModelFromId(undefined), null);
  assert.strictEqual(parseModelFromId(42), null);
});

test('model: returns null when a Claude id resolves to no alphabetic family', () => {
  assert.strictEqual(parseModelFromId('claude-3-5'), null);
});
