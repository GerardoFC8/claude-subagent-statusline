'use strict';

const path = require('node:path');

const PLUGIN_ROOT_PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';
const STATUSLINE_REL_PATH = 'scripts/statusline.js';

function desiredCommand() {
  return `node "${PLUGIN_ROOT_PLACEHOLDER}/${STATUSLINE_REL_PATH}"`;
}

function classify(currentCommand, opts) {
  const o = opts || {};
  if (typeof currentCommand !== 'string' || currentCommand.trim() === '') return 'missing';
  if (currentCommand.includes('claude-subagent-statusline')) return 'ours';
  if (
    currentCommand.includes(PLUGIN_ROOT_PLACEHOLDER) &&
    /scripts[\\/]statusline\.(js|sh)/.test(currentCommand)
  ) {
    return 'ours';
  }
  if (o.wrapperPath && currentCommand.includes(o.wrapperPath) && o.wrapperRefersToOurs) return 'ours';
  return 'custom';
}

function planAction(settings, opts) {
  const desired = desiredCommand();
  const currentCommand = settings && settings.statusLine ? settings.statusLine.command : undefined;
  const classification = classify(currentCommand, opts);
  if (classification === 'custom') return { action: 'inform', desired, currentCommand, classification };
  if (classification === 'missing') return { action: 'create', desired, currentCommand, classification };
  if (currentCommand === desired) return { action: 'noop', desired, currentCommand, classification };
  return { action: 'update', desired, currentCommand, classification };
}

function applyAction(plan, settings) {
  if (!plan || plan.action === 'noop' || plan.action === 'inform') return null;
  const next = Object.assign({}, settings || {});
  const prevStatusLine = next.statusLine && typeof next.statusLine === 'object' ? next.statusLine : {};
  next.statusLine = Object.assign({}, prevStatusLine, {
    type: prevStatusLine.type || 'command',
    command: plan.desired,
  });
  return next;
}

function backupPath(settingsPath, now) {
  const stamp = (now || new Date()).toISOString().replace(/[:.]/g, '-');
  return `${settingsPath}.${stamp}.bak`;
}

module.exports = {
  desiredCommand,
  classify,
  planAction,
  applyAction,
  backupPath,
  PLUGIN_ROOT_PLACEHOLDER,
  STATUSLINE_REL_PATH,
};
