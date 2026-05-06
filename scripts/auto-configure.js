#!/usr/bin/env node
'use strict';

// SessionStart hook entry point. Idempotent. Never throws to the user's session.
// Reads ~/.claude/settings.json and ensures `statusLine.command` points to this
// plugin's renderer when safe. Respects existing custom statusLine configurations.
// Opt-out: set CSL_NO_AUTO_CONFIGURE=1.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { planAction, applyAction, backupPath } = require('./lib/configure');

function main() {
  if (process.env.CSL_NO_AUTO_CONFIGURE === '1') return 0;

  const home = os.homedir();
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const wrapperPath = path.join(home, '.claude', 'statusline-command.sh');

  let raw = null;
  try {
    raw = fs.readFileSync(settingsPath, 'utf-8');
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      process.stderr.write(`[claude-subagent-statusline] could not read settings.json: ${err.message}\n`);
      return 0;
    }
  }

  let settings = {};
  if (raw !== null) {
    try {
      settings = JSON.parse(raw);
    } catch (_) {
      process.stderr.write('[claude-subagent-statusline] settings.json is not valid JSON; skipping auto-configure.\n');
      return 0;
    }
  }

  let wrapperRefersToOurs = false;
  try {
    const wrapperContent = fs.readFileSync(wrapperPath, 'utf-8');
    wrapperRefersToOurs = wrapperContent.includes('claude-subagent-statusline');
  } catch (_) {
    // wrapper not present — ignore
  }

  const plan = planAction(settings, { wrapperPath, wrapperRefersToOurs });

  if (plan.action === 'noop') return 0;

  if (plan.action === 'inform') {
    const escaped = plan.desired.replace(/"/g, '\\"');
    process.stdout.write(
      '[claude-subagent-statusline] Detected a custom statusLine — keeping yours intact.\n' +
        '  To switch to this plugin, edit ~/.claude/settings.json and set:\n' +
        `    "statusLine": { "type": "command", "command": "${escaped}" }\n` +
        '  Set CSL_NO_AUTO_CONFIGURE=1 to silence this message.\n',
    );
    return 0;
  }

  // 'create' or 'update'
  const next = applyAction(plan, settings);
  const dir = path.dirname(settingsPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    process.stderr.write(`[claude-subagent-statusline] could not create ${dir}: ${err.message}\n`);
    return 0;
  }

  if (raw !== null) {
    try {
      fs.writeFileSync(backupPath(settingsPath), raw, 'utf-8');
    } catch (err) {
      process.stderr.write(`[claude-subagent-statusline] backup failed; aborting write: ${err.message}\n`);
      return 0;
    }
  }

  const tmp = `${settingsPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, settingsPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    process.stderr.write(`[claude-subagent-statusline] could not write settings.json: ${err.message}\n`);
    return 0;
  }

  if (plan.action === 'create') {
    process.stdout.write(
      `[claude-subagent-statusline] Auto-configured statusLine in ${settingsPath}.\n`,
    );
  } else {
    process.stdout.write(
      `[claude-subagent-statusline] Updated statusLine in ${settingsPath}.\n` +
        `  Previous: ${plan.currentCommand}\n` +
        `  Now:      ${plan.desired}\n`,
    );
  }
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  process.stderr.write(`[claude-subagent-statusline] auto-configure crashed: ${err && err.message}\n`);
  process.exit(0);
}
