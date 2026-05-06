// scripts/lib/history.js
// CommonJS module. No top-level side effects (safe to require many times).
// Slice 1: read-side + session-start helpers. Slice 2: write-side added.
const fs = require('fs');
const path = require('path');
const os = require('os');

const HISTORY_PLUGIN_DIR_NAME =
  'claude-subagent-statusline-claude-subagent-statusline';

function nowIsoZ() {
  return new Date().toISOString();
}

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isoToEpochSeconds(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

// Per-session counter file path. Mirrors bash:
//   ${HOME}/.claude/state/delegations-${session_id}.jsonl
function counterPath(sessionId) {
  return path.join(os.homedir(), '.claude', 'state',
    `delegations-${sessionId}.jsonl`);
}

// Per-session start timestamp file path. Mirrors bash:
//   ${HOME}/.claude/state/session-start-${session_id}
function sessionStartPath(sessionId) {
  return path.join(os.homedir(), '.claude', 'state',
    `session-start-${sessionId}`);
}

// History file path — three-tier resolution, identical to history-lib.sh:
//   1. ${CLAUDE_PLUGIN_DATA}/history.jsonl       (env override; hooks subprocess)
//   2. ${HOME}/.claude/plugins/data/<convention-dir>/history.jsonl  (if dir exists)
//   3. ${HOME}/.claude/state/delegation-history.jsonl   (legacy fallback)
function historyPath() {
  const envDir = process.env.CLAUDE_PLUGIN_DATA;
  if (envDir && envDir.length > 0) {
    return path.join(envDir, 'history.jsonl');
  }
  const conventionDir = path.join(os.homedir(), '.claude', 'plugins', 'data',
    HISTORY_PLUGIN_DIR_NAME);
  try {
    if (fs.statSync(conventionDir).isDirectory()) {
      return path.join(conventionDir, 'history.jsonl');
    }
  } catch (_) { /* ENOENT etc. → fall through */ }
  return path.join(os.homedir(), '.claude', 'state', 'delegation-history.jsonl');
}

// Atomic write helper: tmp-in-same-dir + rename. Best-effort; no throw.
// Used for session-start file and for ring-buffer trim.
function atomicWrite(filePath, contents) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `${path.basename(filePath)}.tmp.${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, contents);
    fs.renameSync(tmp, filePath);
  } catch (_) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

// Count a session's delegation file, deduplicated by id, into running/done/failed.
// Mirrors statusline.sh jq queries. Returns { running, done, failed, oldestStarted }.
function readCounters(sessionId) {
  const empty = { running: 0, done: 0, failed: 0, oldestStarted: null };
  if (!sessionId) return empty;
  const file = counterPath(sessionId);
  let data;
  try { data = fs.readFileSync(file, 'utf8'); } catch (_) { return empty; }
  const doneIds = new Set();
  const failedIds = new Set();
  const runningIds = new Set();
  let oldest = null;
  for (const raw of data.split('\n')) {
    if (!raw) continue;
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { continue; }
    if (!obj || typeof obj !== 'object') continue;
    const id = obj.id;
    if (typeof id !== 'string' || id === '') continue;
    if (obj.status === 'done')    doneIds.add(id);
    if (obj.status === 'failed')  failedIds.add(id);
    if (obj.status === 'running') runningIds.add(id);
    if (typeof obj.started === 'string' && obj.started !== '') {
      if (oldest === null || obj.started < oldest) oldest = obj.started;
    }
  }
  let running = 0;
  for (const id of runningIds) {
    if (!doneIds.has(id) && !failedIds.has(id)) running++;
  }
  return {
    running,
    done:   doneIds.size,
    failed: failedIds.size,
    oldestStarted: oldest,
  };
}

// ---------------------------------------------------------------------------
// SLICE 2 — Write-side helpers
// ---------------------------------------------------------------------------

// Append a single JSONL line to the per-session counter file.
// Best-effort: never throws to caller. mkdir -p for parent.
function counterAppend(sessionId, obj) {
  if (!sessionId) return;
  const file = counterPath(sessionId);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  } catch (_) { /* swallow */ }
}

// Append a single JSONL line to the global history file.
// Calls historyTrimIfNeeded after the append. Best-effort.
function historyAppend(obj) {
  const file = historyPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  } catch (_) { return; }
  historyTrimIfNeeded();
}

// Ring buffer: when line count exceeds threshold, keep last KEEP via tmp + rename.
// Threshold/keep configurable via env (parity with bash defaults).
// Idempotent: safe to call when file does not exist (no-op).
function historyTrimIfNeeded() {
  const file = historyPath();
  let data;
  try { data = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
  // Count newlines the same way wc -l does.
  let nl = 0;
  for (let i = 0; i < data.length; i++) if (data.charCodeAt(i) === 10) nl++;
  const threshold = parseInt(process.env.HISTORY_TRIM_THRESHOLD || '600', 10) || 600;
  if (nl <= threshold) return;
  const keep = parseInt(process.env.HISTORY_KEEP || '500', 10) || 500;
  const lines = data.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const tail = lines.slice(-keep);
  atomicWrite(file, tail.join('\n') + '\n');
}

module.exports = {
  // Path helpers
  historyPath,
  counterPath,
  sessionStartPath,
  // Atomic write
  atomicWrite,
  // Read helpers
  readCounters,
  // Write helpers (slice 2)
  counterAppend,
  historyAppend,
  historyTrimIfNeeded,
  // Time
  nowIsoZ,
  nowEpochSeconds,
  isoToEpochSeconds,
};
