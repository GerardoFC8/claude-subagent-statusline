'use strict';

const path = require('node:path');

const PLUGIN_ROOT_PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';
const STATUSLINE_REL_PATH = 'scripts/statusline.js';
// Seconds between forced re-renders. Keeps time-based segments (rate-limit
// countdown, elapsed) live while the user is idle. Claude Code re-runs the
// statusLine.command on this interval in addition to its normal triggers.
const DESIRED_REFRESH_INTERVAL = 30;

function desiredCommand(pluginRoot) {
  if (typeof pluginRoot !== 'string' || pluginRoot.trim() === '') {
    throw new Error('desiredCommand requires an absolute pluginRoot path');
  }
  // Normalize to forward slashes so the same command shape works on every OS.
  // Node and the Windows shell both accept forward slashes in absolute paths.
  const normRoot = pluginRoot.replace(/\\/g, '/');
  return `node "${normRoot}/scripts/statusline.js"`;
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
  const o = opts || {};
  if (typeof o.pluginRoot !== 'string' || o.pluginRoot.trim() === '') {
    throw new Error('planAction requires opts.pluginRoot');
  }
  const desired = desiredCommand(o.pluginRoot);
  const desiredRefreshInterval = DESIRED_REFRESH_INTERVAL;
  const currentStatusLine =
    settings && settings.statusLine && typeof settings.statusLine === 'object'
      ? settings.statusLine
      : undefined;
  const currentCommand = currentStatusLine ? currentStatusLine.command : undefined;
  const currentRefreshInterval = currentStatusLine ? currentStatusLine.refreshInterval : undefined;
  const classification = classify(currentCommand, opts);

  if (classification === 'custom') {
    return { action: 'inform', desired, desiredRefreshInterval, currentCommand, classification };
  }
  if (classification === 'missing') {
    return { action: 'create', desired, desiredRefreshInterval, currentCommand, classification };
  }

  // classification === 'ours' — also require refreshInterval to be present so v0.10.1
  // installs get upgraded on next session start.
  const commandMatches = currentCommand === desired;
  const refreshIntervalPresent = typeof currentRefreshInterval === 'number';
  if (commandMatches && refreshIntervalPresent) {
    return { action: 'noop', desired, desiredRefreshInterval, currentCommand, classification };
  }
  return { action: 'update', desired, desiredRefreshInterval, currentCommand, classification };
}

function applyAction(plan, settings) {
  if (!plan || plan.action === 'noop' || plan.action === 'inform') return null;
  const next = Object.assign({}, settings || {});
  const prevStatusLine =
    next.statusLine && typeof next.statusLine === 'object' ? next.statusLine : {};
  // Preserve a user-set refreshInterval; only inject the default when missing.
  const prevRefreshInterval =
    typeof prevStatusLine.refreshInterval === 'number' ? prevStatusLine.refreshInterval : undefined;
  const refreshInterval =
    prevRefreshInterval !== undefined ? prevRefreshInterval : plan.desiredRefreshInterval;
  next.statusLine = Object.assign({}, prevStatusLine, {
    type: prevStatusLine.type || 'command',
    command: plan.desired,
    refreshInterval,
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
  DESIRED_REFRESH_INTERVAL,
};
