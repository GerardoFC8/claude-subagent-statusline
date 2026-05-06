// tests/manifest.test.js — REQ-MANIFEST-103, REQ-MANIFEST-104
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// package.json assertions (slice 1)
// ---------------------------------------------------------------------------

test('manifest: package.json exists', () => {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  assert.ok(fs.existsSync(pkgPath), 'package.json must exist at repo root');
});

test('manifest: package.json type equals commonjs', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.type, 'commonjs');
});

test('manifest: package.json engines.node equals >=18.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.engines && pkg.engines.node, '>=18.0.0');
});

test('manifest: package.json has no dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});
  assert.strictEqual(deps.length, 0, 'No dependencies allowed');
  assert.strictEqual(devDeps.length, 0, 'No devDependencies allowed');
});

// ---------------------------------------------------------------------------
// plugin.json assertions — version stays 0.5.0 for slice 1
// ---------------------------------------------------------------------------

test('manifest: plugin.json is valid JSON', () => {
  const pluginPath = path.join(REPO_ROOT, '.claude-plugin', 'plugin.json');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(pluginPath, 'utf8')));
});

test('manifest: plugin.json has name field', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.ok(typeof plugin.name === 'string' && plugin.name.length > 0, 'name field must exist');
});

test('manifest: plugin.json version equals 0.5.0 (slice 1 — not bumped yet)', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(plugin.version, '0.5.0');
});

// ---------------------------------------------------------------------------
// hooks.json assertions — slice 1: assert validity + 3 entries, NOT suffix
// ---------------------------------------------------------------------------

test('manifest: hooks.json is valid JSON', () => {
  const hooksPath = path.join(REPO_ROOT, 'hooks', 'hooks.json');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(hooksPath, 'utf8')));
});

test('manifest: hooks.json has 3 hook entries (PreToolUse, PostToolUse, PostToolUseFailure)', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.ok(hooks.hooks.PreToolUse, 'PreToolUse must exist');
  assert.ok(hooks.hooks.PostToolUse, 'PostToolUse must exist');
  assert.ok(hooks.hooks.PostToolUseFailure, 'PostToolUseFailure must exist');
});

// ---------------------------------------------------------------------------
// hooks.json slice 2 assertions — commands must reference .js, start with node
// (REQ-HOOKS-101, REQ-HOOKS-102, REQ-HOOKS-103, REQ-MANIFEST-101)
// ---------------------------------------------------------------------------

test('manifest: hooks.json PreToolUse command starts with node and references .js', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const cmd = hooks.hooks.PreToolUse[0].hooks[0].command;
  assert.ok(cmd.startsWith('node '), `PreToolUse command must start with "node ": ${cmd}`);
  assert.ok(cmd.includes('track-delegation-pre.js'), `must reference track-delegation-pre.js: ${cmd}`);
});

test('manifest: hooks.json PostToolUse command starts with node and references .js', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const cmd = hooks.hooks.PostToolUse[0].hooks[0].command;
  assert.ok(cmd.startsWith('node '), `PostToolUse command must start with "node ": ${cmd}`);
  assert.ok(cmd.includes('track-delegation-post.js'), `must reference track-delegation-post.js: ${cmd}`);
});

test('manifest: hooks.json PostToolUseFailure command starts with node and references .js', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const cmd = hooks.hooks.PostToolUseFailure[0].hooks[0].command;
  assert.ok(cmd.startsWith('node '), `PostToolUseFailure command must start with "node ": ${cmd}`);
  assert.ok(cmd.includes('track-delegation-fail.js'), `must reference track-delegation-fail.js: ${cmd}`);
});

test('manifest: hooks.json has no .sh references (REQ-MANIFEST-101)', () => {
  const hooksText = fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8');
  assert.ok(!hooksText.includes('.sh'), 'hooks.json must not contain any .sh references');
});
