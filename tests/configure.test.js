'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { mkTmpHome, cleanupTmpHome } = require('./_helpers');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONFIGURE_LIB = path.join(REPO_ROOT, 'scripts', 'lib', 'configure.js');
const AUTO_CONFIGURE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'auto-configure.js');
// Fixture mirrors the real-world install path shape, which always includes the
// plugin name as a directory segment (e.g. ~/.claude/plugins/cache/<m>/<plugin>/<v>/).
const PLUGIN_ROOT = '/fake/cache/claude-subagent-statusline/claude-subagent-statusline/9.9.9';
const PLUGIN_OPTS = { pluginRoot: PLUGIN_ROOT };

const lib = require(CONFIGURE_LIB);

function readSettings(home) {
  const p = path.join(home, '.claude', 'settings.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeSettings(home, obj) {
  const dir = path.join(home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(obj, null, 2), 'utf-8');
}

function listBackups(home) {
  const dir = path.join(home, '.claude');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.startsWith('settings.json.') && n.endsWith('.bak'));
}

function runAutoConfigure(home, env = {}) {
  return spawnSync(process.execPath, [AUTO_CONFIGURE_SCRIPT], {
    env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
    encoding: 'utf-8',
  });
}

// ---------- classify() unit tests ----------

test('classify: missing command returns "missing"', () => {
  assert.equal(lib.classify(undefined), 'missing');
  assert.equal(lib.classify(null), 'missing');
  assert.equal(lib.classify(''), 'missing');
  assert.equal(lib.classify('   '), 'missing');
});

test('classify: command containing claude-subagent-statusline returns "ours"', () => {
  assert.equal(
    lib.classify('node "${CLAUDE_PLUGIN_ROOT}/scripts/statusline.js"'),
    'ours',
    'CLAUDE_PLUGIN_ROOT does not contain plugin name; should be classified by other hint',
  );
  assert.equal(
    lib.classify('/path/to/claude-subagent-statusline/scripts/statusline.js'),
    'ours',
  );
});

test('classify: wrapper that delegates to our plugin returns "ours"', () => {
  const result = lib.classify('bash /home/u/.claude/statusline-command.sh', {
    wrapperPath: '/home/u/.claude/statusline-command.sh',
    wrapperRefersToOurs: true,
  });
  assert.equal(result, 'ours');
});

test('classify: wrapper that does NOT reference our plugin returns "custom"', () => {
  const result = lib.classify('bash /home/u/.claude/statusline-command.sh', {
    wrapperPath: '/home/u/.claude/statusline-command.sh',
    wrapperRefersToOurs: false,
  });
  assert.equal(result, 'custom');
});

test('classify: arbitrary command returns "custom"', () => {
  assert.equal(lib.classify('starship'), 'custom');
  assert.equal(lib.classify('node /opt/something/else.js'), 'custom');
});

// ---------- planAction() unit tests ----------

test('planAction: settings without statusLine → action "create"', () => {
  const plan = lib.planAction({}, PLUGIN_OPTS);
  assert.equal(plan.action, 'create');
  assert.ok(plan.desired.includes(PLUGIN_ROOT), 'desired must include absolute pluginRoot');
  assert.match(plan.desired, /scripts[\\/]statusline\.js/);
  assert.ok(!plan.desired.includes('${CLAUDE_PLUGIN_ROOT}'), 'desired must NOT contain the placeholder');
});

test('planAction: null settings → action "create"', () => {
  const plan = lib.planAction(null, PLUGIN_OPTS);
  assert.equal(plan.action, 'create');
});

test('planAction: statusLine.command empty → action "create"', () => {
  const plan = lib.planAction({ statusLine: { command: '' } }, PLUGIN_OPTS);
  assert.equal(plan.action, 'create');
});

test('planAction: ours, command equal, refreshInterval present → action "noop"', () => {
  const desired = lib.desiredCommand(PLUGIN_ROOT);
  const plan = lib.planAction(
    { statusLine: { command: desired, refreshInterval: 30 } },
    PLUGIN_OPTS,
  );
  assert.equal(plan.action, 'noop');
});

test('planAction: ours, command equal, refreshInterval missing → action "update"', () => {
  // Upgrade path from v0.10.1 (no refreshInterval) to v0.10.2+ (refreshInterval=30).
  const desired = lib.desiredCommand(PLUGIN_ROOT);
  const plan = lib.planAction({ statusLine: { command: desired } }, PLUGIN_OPTS);
  assert.equal(plan.action, 'update');
  assert.equal(plan.desiredRefreshInterval, 30);
});

test('planAction: ours but pointing to old bash form → action "update"', () => {
  const plan = lib.planAction(
    { statusLine: { command: 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh"' } },
    PLUGIN_OPTS,
  );
  assert.equal(plan.action, 'update');
});

test('planAction: ours but pointing to legacy ${CLAUDE_PLUGIN_ROOT} placeholder → action "update"', () => {
  // v0.6.1 wrote settings using the placeholder which Claude Code does not expand
  // in user settings.json. v0.6.2+ writes absolute paths instead — this case must
  // detect the legacy form as ours-stale and rewrite it on the next session start.
  const plan = lib.planAction(
    { statusLine: { command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/statusline.js"' } },
    PLUGIN_OPTS,
  );
  assert.equal(plan.action, 'update');
  assert.ok(plan.desired.includes(PLUGIN_ROOT));
});

test('planAction: custom statusLine → action "inform"', () => {
  const plan = lib.planAction({ statusLine: { command: 'starship' } }, PLUGIN_OPTS);
  assert.equal(plan.action, 'inform');
});

test('planAction: throws when pluginRoot is missing', () => {
  assert.throws(() => lib.planAction({}), /pluginRoot/);
  assert.throws(() => lib.planAction({}, {}), /pluginRoot/);
});

test('desiredCommand: throws when pluginRoot is missing or empty', () => {
  assert.throws(() => lib.desiredCommand(), /pluginRoot/);
  assert.throws(() => lib.desiredCommand(''), /pluginRoot/);
  assert.throws(() => lib.desiredCommand('   '), /pluginRoot/);
});

test('desiredCommand: produces absolute-path command without placeholder', () => {
  const cmd = lib.desiredCommand('/some/abs/path');
  assert.equal(cmd, 'node "/some/abs/path/scripts/statusline.js"');
  assert.ok(!cmd.includes('${CLAUDE_PLUGIN_ROOT}'));
});

// ---------- applyAction() unit tests ----------

test('applyAction: create produces statusLine block with type, command, and default refreshInterval', () => {
  const plan = lib.planAction({}, PLUGIN_OPTS);
  const next = lib.applyAction(plan, {});
  assert.equal(next.statusLine.command, plan.desired);
  assert.equal(next.statusLine.type, 'command');
  assert.equal(next.statusLine.refreshInterval, 30);
});

test('applyAction: preserves user-set refreshInterval when upgrading command', () => {
  const original = {
    statusLine: { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh"', refreshInterval: 10 },
  };
  const plan = lib.planAction(original, PLUGIN_OPTS);
  assert.equal(plan.action, 'update');
  const next = lib.applyAction(plan, original);
  assert.equal(next.statusLine.command, plan.desired);
  assert.equal(next.statusLine.refreshInterval, 10, 'user value must win over default');
});

test('applyAction: writes default refreshInterval when missing on upgrade', () => {
  const desired = lib.desiredCommand(PLUGIN_ROOT);
  const original = { statusLine: { type: 'command', command: desired } };
  const plan = lib.planAction(original, PLUGIN_OPTS);
  assert.equal(plan.action, 'update');
  const next = lib.applyAction(plan, original);
  assert.equal(next.statusLine.command, desired);
  assert.equal(next.statusLine.refreshInterval, 30);
});

test('applyAction: update preserves other settings.json keys', () => {
  const original = {
    theme: 'dark',
    permissions: { allow: ['Bash'] },
    statusLine: { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh"' },
  };
  const plan = lib.planAction(original, PLUGIN_OPTS);
  assert.equal(plan.action, 'update', 'sanity: this fixture must trigger an update');
  const next = lib.applyAction(plan, original);
  assert.equal(next.theme, 'dark');
  assert.deepEqual(next.permissions, { allow: ['Bash'] });
  assert.equal(next.statusLine.command, plan.desired);
  assert.equal(next.statusLine.type, 'command');
});

test('applyAction: noop and inform return null (no mutation)', () => {
  const noop = lib.applyAction({ action: 'noop' }, { foo: 1 });
  const inform = lib.applyAction({ action: 'inform' }, { foo: 1 });
  assert.equal(noop, null);
  assert.equal(inform, null);
});

test('backupPath: includes ISO timestamp components and ends in .bak', () => {
  const fixed = new Date('2026-05-06T12:34:56.789Z');
  const p = lib.backupPath('/home/u/.claude/settings.json', fixed);
  assert.match(p, /settings\.json\.2026-05-06T12-34-56-789Z\.bak$/);
});

// ---------- auto-configure.js integration tests ----------

test('auto-configure: creates settings.json when missing', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  const result = runAutoConfigure(home);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const settings = readSettings(home);
  assert.ok(settings.statusLine, 'statusLine block should be created');
  assert.match(settings.statusLine.command, /scripts\/statusline\.js/);
  assert.equal(settings.statusLine.type, 'command');
  // No backup since original file did not exist.
  assert.equal(listBackups(home).length, 0);
});

test('auto-configure: updates old bash command to node form, leaves backup', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  writeSettings(home, {
    theme: 'dark',
    statusLine: { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh"' },
  });

  const result = runAutoConfigure(home);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const settings = readSettings(home);
  assert.match(settings.statusLine.command, /node .*scripts\/statusline\.js/);
  assert.equal(settings.theme, 'dark', 'should preserve unrelated keys');

  const backups = listBackups(home);
  assert.equal(backups.length, 1, 'one backup should exist');
});

test('auto-configure: noop when already correct', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  // The script resolves pluginRoot from __dirname, so the desired commands for
  // the noop fixture must match what the script will compute against REPO_ROOT.
  // Both the statusLine AND the additive subagentStatusLine must already be
  // correct for this to be a true noop (no write, no backup).
  const desired = lib.desiredCommand(REPO_ROOT);
  const desiredSubagent = lib.desiredSubagentCommand(REPO_ROOT);
  writeSettings(home, {
    statusLine: { type: 'command', command: desired, refreshInterval: 30 },
    // Proven subagentStatusLine shape: {type, command}, no refreshInterval.
    subagentStatusLine: { type: 'command', command: desiredSubagent },
  });

  const before = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf-8');
  const result = runAutoConfigure(home);
  assert.equal(result.status, 0);
  const after = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf-8');

  assert.equal(before, after, 'settings.json must not change');
  assert.equal(listBackups(home).length, 0, 'no backup on noop');
});

test('auto-configure: upgrades v0.10.1 settings (correct command, no refreshInterval) to add 30s default', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  // Simulates an existing v0.10.1 install: command is already correct and absolute,
  // but refreshInterval is missing — auto-configure must add it on next session start.
  const desired = lib.desiredCommand(REPO_ROOT);
  writeSettings(home, { theme: 'dark', statusLine: { type: 'command', command: desired } });

  const result = runAutoConfigure(home);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const settings = readSettings(home);
  assert.equal(settings.statusLine.command, desired, 'command must stay the same');
  assert.equal(settings.statusLine.refreshInterval, 30, 'default refreshInterval must be added');
  assert.equal(settings.theme, 'dark', 'unrelated keys must be preserved');
  assert.equal(listBackups(home).length, 1, 'one backup must exist');
});

test('auto-configure: leaves custom statusLine intact and informs the user', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  writeSettings(home, { statusLine: { type: 'command', command: 'starship' } });

  const result = runAutoConfigure(home);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /custom statusLine/i);
  assert.match(result.stdout, /CSL_NO_AUTO_CONFIGURE/);

  const settings = readSettings(home);
  assert.equal(settings.statusLine.command, 'starship', 'custom command must be preserved');
  assert.equal(listBackups(home).length, 0, 'no backup when not modifying');
});

test('auto-configure: malformed settings.json is left untouched, exits 0', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  const dir = path.join(home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, '{ this is: not json', 'utf-8');

  const result = runAutoConfigure(home);
  assert.equal(result.status, 0, 'must not crash the session');
  const after = fs.readFileSync(settingsPath, 'utf-8');
  assert.equal(after, '{ this is: not json', 'malformed file must be left alone');
  assert.equal(listBackups(home).length, 0);
});

test('auto-configure: opt-out via CSL_NO_AUTO_CONFIGURE=1', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  // No settings.json — opt-out should mean: do nothing
  const result = runAutoConfigure(home, { CSL_NO_AUTO_CONFIGURE: '1' });
  assert.equal(result.status, 0);
  assert.equal(
    fs.existsSync(path.join(home, '.claude', 'settings.json')),
    false,
    'opt-out must skip even create-from-scratch',
  );
});

test('auto-configure: detects bash wrapper that points to our plugin and upgrades it', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  // Simulate the user's pre-existing bash wrapper at ~/.claude/statusline-command.sh
  const wrapperPath = path.join(home, '.claude', 'statusline-command.sh');
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(wrapperPath, '#!/usr/bin/env bash\n# resolves claude-subagent-statusline plugin\nexec node "$LATEST"\n', 'utf-8');

  writeSettings(home, {
    statusLine: { type: 'command', command: `bash ${wrapperPath}` },
  });

  const result = runAutoConfigure(home);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const settings = readSettings(home);
  assert.match(settings.statusLine.command, /scripts\/statusline\.js/);
  assert.equal(listBackups(home).length, 1);
});

test('auto-configure: does NOT touch wrapper-style command if wrapper does not reference our plugin', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  const wrapperPath = path.join(home, '.claude', 'statusline-command.sh');
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(wrapperPath, '#!/usr/bin/env bash\necho "[mine] always"\n', 'utf-8');

  writeSettings(home, {
    statusLine: { type: 'command', command: `bash ${wrapperPath}` },
  });

  const result = runAutoConfigure(home);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /custom statusLine/i);

  const settings = readSettings(home);
  assert.equal(settings.statusLine.command, `bash ${wrapperPath}`, 'unrelated wrapper preserved');
});

// ---------- subagentStatusLine (additive) unit tests ----------

test('desiredSubagentCommand: produces absolute-path command to subagent-statusline.js', () => {
  const cmd = lib.desiredSubagentCommand('/some/abs/path');
  assert.equal(cmd, 'node "/some/abs/path/scripts/subagent-statusline.js"');
  assert.ok(!cmd.includes('${CLAUDE_PLUGIN_ROOT}'));
});

test('desiredSubagentCommand: throws when pluginRoot is missing or empty', () => {
  assert.throws(() => lib.desiredSubagentCommand(), /pluginRoot/);
  assert.throws(() => lib.desiredSubagentCommand(''), /pluginRoot/);
  assert.throws(() => lib.desiredSubagentCommand('   '), /pluginRoot/);
});

test('classifySubagent: missing command returns "missing"', () => {
  assert.equal(lib.classifySubagent(undefined), 'missing');
  assert.equal(lib.classifySubagent(''), 'missing');
  assert.equal(lib.classifySubagent('   '), 'missing');
});

test('classifySubagent: command referencing our plugin returns "ours"', () => {
  assert.equal(lib.classifySubagent(lib.desiredSubagentCommand(PLUGIN_ROOT)), 'ours');
  assert.equal(
    lib.classifySubagent('node "${CLAUDE_PLUGIN_ROOT}/scripts/subagent-statusline.js"'),
    'ours',
  );
});

test('classifySubagent: arbitrary command returns "custom"', () => {
  assert.equal(lib.classifySubagent('my-own-subagent-renderer'), 'custom');
  assert.equal(lib.classifySubagent('node /opt/other/thing.js'), 'custom');
});

test('planSubagentAction: missing → create, custom → skip, ours+command-match → noop, ours+stale → update', () => {
  const desired = lib.desiredSubagentCommand(PLUGIN_ROOT);
  assert.equal(lib.planSubagentAction('missing', undefined, undefined, desired), 'create');
  assert.equal(lib.planSubagentAction('custom', 'x', 30, desired), 'skip');
  // The written shape is {type, command} with NO refreshInterval, so a matching
  // command is a true noop regardless of whether a refreshInterval is present.
  assert.equal(lib.planSubagentAction('ours', desired, 30, desired), 'noop');
  assert.equal(lib.planSubagentAction('ours', desired, undefined, desired), 'noop');
  assert.equal(lib.planSubagentAction('ours', 'stale', undefined, desired), 'update');
  assert.equal(lib.planSubagentAction('ours', 'stale', 30, desired), 'update');
});

test('planAction: reports subagentAction "create" when subagentStatusLine is absent', () => {
  const plan = lib.planAction({}, PLUGIN_OPTS);
  assert.equal(plan.subagentAction, 'create');
  assert.ok(plan.desiredSubagent.includes(PLUGIN_ROOT));
  assert.match(plan.desiredSubagent, /scripts[\\/]subagent-statusline\.js/);
});

test('planAction: reports subagentAction "skip" for a custom subagentStatusLine', () => {
  const desired = lib.desiredCommand(PLUGIN_ROOT);
  const plan = lib.planAction(
    { statusLine: { command: desired, refreshInterval: 30 }, subagentStatusLine: { command: 'starship-subs' } },
    PLUGIN_OPTS,
  );
  assert.equal(plan.action, 'noop', 'statusLine already correct');
  assert.equal(plan.subagentAction, 'skip', 'custom subagent renderer must be left intact');
});

test('planAction: subagent decision does not alter the statusLine action', () => {
  // statusLine correct+refresh present, subagent missing → statusLine stays "noop".
  const desired = lib.desiredCommand(PLUGIN_ROOT);
  const plan = lib.planAction({ statusLine: { command: desired, refreshInterval: 30 } }, PLUGIN_OPTS);
  assert.equal(plan.action, 'noop');
  assert.equal(plan.subagentAction, 'create');
});

test('applyAction: create also registers the subagentStatusLine block as {type, command}', () => {
  const plan = lib.planAction({}, PLUGIN_OPTS);
  const next = lib.applyAction(plan, {});
  assert.equal(next.subagentStatusLine.command, plan.desiredSubagent);
  assert.equal(next.subagentStatusLine.type, 'command');
  // Proven contract: subagentStatusLine has NO refreshInterval.
  assert.ok(
    !('refreshInterval' in next.subagentStatusLine),
    'subagentStatusLine must not carry a refreshInterval',
  );
});

test('applyAction: registers subagentStatusLine even when statusLine is a noop', () => {
  const desired = lib.desiredCommand(PLUGIN_ROOT);
  const original = { statusLine: { type: 'command', command: desired, refreshInterval: 30 } };
  const plan = lib.planAction(original, PLUGIN_OPTS);
  assert.equal(plan.action, 'noop');
  const next = lib.applyAction(plan, original);
  assert.ok(next, 'must produce a write to add the additive key');
  assert.equal(next.subagentStatusLine.command, plan.desiredSubagent);
  // statusLine must be preserved unchanged.
  assert.equal(next.statusLine.command, desired);
  assert.equal(next.statusLine.refreshInterval, 30);
});

test('applyAction: does not overwrite a custom subagentStatusLine', () => {
  const desired = lib.desiredCommand(PLUGIN_ROOT);
  const original = {
    statusLine: { type: 'command', command: desired, refreshInterval: 30 },
    subagentStatusLine: { type: 'command', command: 'my-custom-subs' },
  };
  const plan = lib.planAction(original, PLUGIN_OPTS);
  const next = lib.applyAction(plan, original);
  // Both keys already correct/custom → nothing to write.
  assert.equal(next, null);
});

test('applyAction: preserves user-set subagent refreshInterval on update', () => {
  const stale = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/subagent-statusline.js"';
  const original = {
    statusLine: { type: 'command', command: 'starship' }, // custom → inform short-circuits
    subagentStatusLine: { type: 'command', command: stale, refreshInterval: 10 },
  };
  // With a custom statusLine, applyAction returns null (we never touch either key).
  const plan = lib.planAction(original, PLUGIN_OPTS);
  assert.equal(plan.action, 'inform');
  assert.equal(lib.applyAction(plan, original), null);
});

// ---------- subagentStatusLine auto-configure integration tests ----------

test('auto-configure: registers subagentStatusLine when creating settings.json from scratch', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  const result = runAutoConfigure(home);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const settings = readSettings(home);
  assert.ok(settings.subagentStatusLine, 'subagentStatusLine block should be created');
  assert.match(settings.subagentStatusLine.command, /scripts\/subagent-statusline\.js/);
  assert.equal(settings.subagentStatusLine.type, 'command');
});

test('auto-configure: adds subagentStatusLine to an existing correct statusLine (subagent-only write)', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  // statusLine already fully correct; only the additive key is missing.
  const desired = lib.desiredCommand(REPO_ROOT);
  writeSettings(home, {
    theme: 'dark',
    statusLine: { type: 'command', command: desired, refreshInterval: 30 },
  });

  const result = runAutoConfigure(home);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /subagentStatusLine/i);

  const settings = readSettings(home);
  assert.match(settings.subagentStatusLine.command, /scripts\/subagent-statusline\.js/);
  assert.equal(settings.statusLine.command, desired, 'statusLine must be untouched');
  assert.equal(settings.theme, 'dark', 'unrelated keys preserved');
  assert.equal(listBackups(home).length, 1, 'a backup must be written before the change');
});

test('auto-configure: leaves a custom subagentStatusLine intact', (t) => {
  const home = mkTmpHome();
  t.after(() => cleanupTmpHome(home));

  const desired = lib.desiredCommand(REPO_ROOT);
  const desiredSubagent = lib.desiredSubagentCommand(REPO_ROOT);
  writeSettings(home, {
    statusLine: { type: 'command', command: desired, refreshInterval: 30 },
    subagentStatusLine: { type: 'command', command: 'my-own-subagent-line' },
  });

  const result = runAutoConfigure(home);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  const settings = readSettings(home);
  assert.equal(
    settings.subagentStatusLine.command,
    'my-own-subagent-line',
    'custom subagent renderer must be preserved',
  );
  assert.notEqual(settings.subagentStatusLine.command, desiredSubagent);
  assert.equal(listBackups(home).length, 0, 'nothing to write → no backup');
});
