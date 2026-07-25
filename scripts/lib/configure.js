'use strict';

const path = require('node:path');

const PLUGIN_ROOT_PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';
const STATUSLINE_REL_PATH = 'scripts/statusline.js';
// Second, additive statusline contract (Claude Code v2.1.205+): renders one row
// per running sub-agent. Registered under the `subagentStatusLine` key, which
// older Claude Code versions ignore, so wiring it up is always backward-safe.
const SUBAGENT_STATUSLINE_REL_PATH = 'scripts/subagent-statusline.js';
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

function desiredSubagentCommand(pluginRoot) {
  if (typeof pluginRoot !== 'string' || pluginRoot.trim() === '') {
    throw new Error('desiredSubagentCommand requires an absolute pluginRoot path');
  }
  const normRoot = pluginRoot.replace(/\\/g, '/');
  return `node "${normRoot}/scripts/subagent-statusline.js"`;
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

// Classify an existing `subagentStatusLine.command`. This is a brand-new key, so
// there is no wrapper/bash legacy to consider — only "missing", "ours", or a
// user-owned "custom" renderer we must never overwrite.
function classifySubagent(currentCommand) {
  if (typeof currentCommand !== 'string' || currentCommand.trim() === '') return 'missing';
  if (currentCommand.includes('claude-subagent-statusline')) return 'ours';
  if (
    currentCommand.includes(PLUGIN_ROOT_PLACEHOLDER) &&
    /scripts[\\/]subagent-statusline\.js/.test(currentCommand)
  ) {
    return 'ours';
  }
  return 'custom';
}

// Decide what to do with the subagentStatusLine key given its classification.
// Returns 'create' | 'update' | 'noop' | 'skip' ('skip' = leave a custom renderer intact).
// The written subagentStatusLine shape is `{ type, command }` with NO refreshInterval
// (the maintainer-validated contract), so a matching command is a true noop — we must
// not require a refreshInterval to be present, or every session would needlessly rewrite.
// `currentRefreshInterval` is accepted for signature stability but intentionally unused.
function planSubagentAction(classification, currentCommand, currentRefreshInterval, desired) {
  if (classification === 'custom') return 'skip';
  if (classification === 'missing') return 'create';
  // classification === 'ours'
  const commandMatches = currentCommand === desired;
  return commandMatches ? 'noop' : 'update';
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

  // subagentStatusLine is planned independently and additively — it never changes
  // the statusLine decision below, so existing behavior is untouched.
  const desiredSubagent = desiredSubagentCommand(o.pluginRoot);
  const currentSubagentLine =
    settings && settings.subagentStatusLine && typeof settings.subagentStatusLine === 'object'
      ? settings.subagentStatusLine
      : undefined;
  const currentSubagentCommand = currentSubagentLine ? currentSubagentLine.command : undefined;
  const currentSubagentRefreshInterval = currentSubagentLine
    ? currentSubagentLine.refreshInterval
    : undefined;
  const subagentClassification = classifySubagent(currentSubagentCommand);
  const subagentAction = planSubagentAction(
    subagentClassification,
    currentSubagentCommand,
    currentSubagentRefreshInterval,
    desiredSubagent,
  );

  const subagent = {
    desiredSubagent,
    currentSubagentCommand,
    subagentClassification,
    subagentAction,
  };

  if (classification === 'custom') {
    return Object.assign(
      { action: 'inform', desired, desiredRefreshInterval, currentCommand, classification },
      subagent,
    );
  }
  if (classification === 'missing') {
    return Object.assign(
      { action: 'create', desired, desiredRefreshInterval, currentCommand, classification },
      subagent,
    );
  }

  // classification === 'ours' — also require refreshInterval to be present so v0.10.1
  // installs get upgraded on next session start.
  const commandMatches = currentCommand === desired;
  const refreshIntervalPresent = typeof currentRefreshInterval === 'number';
  if (commandMatches && refreshIntervalPresent) {
    return Object.assign(
      { action: 'noop', desired, desiredRefreshInterval, currentCommand, classification },
      subagent,
    );
  }
  return Object.assign(
    { action: 'update', desired, desiredRefreshInterval, currentCommand, classification },
    subagent,
  );
}

function applyAction(plan, settings) {
  if (!plan || plan.action === 'inform') return null;

  const statusWrite = plan.action === 'create' || plan.action === 'update';
  const subagentWrite = plan.subagentAction === 'create' || plan.subagentAction === 'update';
  // Nothing to write (both statusLine and subagentStatusLine are already correct).
  if (!statusWrite && !subagentWrite) return null;

  const next = Object.assign({}, settings || {});

  if (statusWrite) {
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
  }

  if (subagentWrite) {
    const prevSubagentLine =
      next.subagentStatusLine && typeof next.subagentStatusLine === 'object'
        ? next.subagentStatusLine
        : {};
    // The proven, maintainer-validated subagentStatusLine registration is
    // `{ type, command }` with NO refreshInterval. Write exactly that shape —
    // do not spread prev, so any stale refreshInterval from an older write is dropped.
    next.subagentStatusLine = {
      type: prevSubagentLine.type || 'command',
      command: plan.desiredSubagent,
    };
  }

  return next;
}

function backupPath(settingsPath, now) {
  const stamp = (now || new Date()).toISOString().replace(/[:.]/g, '-');
  return `${settingsPath}.${stamp}.bak`;
}

module.exports = {
  desiredCommand,
  desiredSubagentCommand,
  classify,
  classifySubagent,
  planSubagentAction,
  planAction,
  applyAction,
  backupPath,
  PLUGIN_ROOT_PLACEHOLDER,
  STATUSLINE_REL_PATH,
  SUBAGENT_STATUSLINE_REL_PATH,
  DESIRED_REFRESH_INTERVAL,
};
