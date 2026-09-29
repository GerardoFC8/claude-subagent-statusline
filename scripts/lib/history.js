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

// A session_id is interpolated into per-session file names, so it must not be
// able to carry a path separator or a dot segment ("../x", "a/b", "..").
// Returns the id when it is safe to use as a file-name fragment, else null.
// Real Claude Code session ids are UUIDs and always pass.
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;
function safeSessionId(id) {
  if (typeof id !== 'string' || !SAFE_SESSION_ID.test(id)) return null;
  if (id === '.' || id === '..') return null;
  return id;
}

// Per-session state file path, or null when the session id is unsafe.
function statePath(sessionId, prefix, suffix) {
  const id = safeSessionId(sessionId);
  if (id === null) return null;
  return path.join(os.homedir(), '.claude', 'state', `${prefix}${id}${suffix}`);
}

// Per-session counter file path (null for an unsafe id). Mirrors bash:
//   ${HOME}/.claude/state/delegations-${session_id}.jsonl
function counterPath(sessionId) {
  return statePath(sessionId, 'delegations-', '.jsonl');
}

// Per-session start timestamp file path (null for an unsafe id). Mirrors bash:
//   ${HOME}/.claude/state/session-start-${session_id}
function sessionStartPath(sessionId) {
  return statePath(sessionId, 'session-start-', '');
}

// Per-session effort handoff file path (null for an unsafe id):
//   ${HOME}/.claude/state/session-effort-${session_id}.json
// Written by scripts/statusline.js (the only payload that carries the session
// effort) and read by scripts/subagent-statusline.js, whose payload does not.
function sessionEffortPath(sessionId) {
  return statePath(sessionId, 'session-effort-', '.json');
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
  const file = counterPath(sessionId);
  if (!file) return empty;
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

// Find the tool_use_id whose JSONL entry has a matching agent_id.
// Used by the SubagentStop hook to correlate a background sub-agent's
// completion to the original Agent delegation. Returns the most recent
// match (last-write-wins) or null if not found / unreadable.
function findToolUseIdByAgentId(sessionId, agentId) {
  const file = counterPath(sessionId);
  if (!file || !agentId) return null;
  let data;
  try { data = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  let foundId = null;
  for (const raw of data.split('\n')) {
    if (!raw) continue;
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { continue; }
    if (!obj || typeof obj !== 'object') continue;
    if (obj.agent_id === agentId && typeof obj.id === 'string' && obj.id !== '') {
      foundId = obj.id;
    }
  }
  return foundId;
}

// Agent names for the per-subagent rows, whose payload only carries the internal
// "local_agent" type. Reads a session's counter file once and returns:
//   byAgentId: agent_id → delegation type (background agents, from bg_launched)
//   byDesc:    description → Set of types of delegations still running
// Entries are aggregated per tool_use_id first, because the done/failed line
// that closes a delegation carries no description. Delegations with an agent_id
// resolve exactly and stay out of byDesc, so they never make a foreground agent
// with the same description ambiguous.
// Maps rather than plain objects: a description is arbitrary text and must not
// collide with prototype keys. Missing/corrupt file → empty maps. Never throws.
function readDelegationTypes(sessionId) {
  const byAgentId = new Map();
  const byDesc = new Map();
  const file = counterPath(sessionId);
  if (!file) return { byAgentId, byDesc };
  let data;
  try { data = fs.readFileSync(file, 'utf8'); } catch (_) { return { byAgentId, byDesc }; }
  const started = new Map(); // tool_use_id → { type, desc }
  const agentIds = new Map(); // agent_id → tool_use_id
  const closed = new Set();
  for (const raw of data.split('\n')) {
    if (!raw) continue;
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { continue; }
    if (!obj || typeof obj !== 'object') continue;
    const id = obj.id;
    if (typeof id !== 'string' || id === '') continue;
    if (obj.status === 'running') {
      started.set(id, {
        // An omitted subagent_type runs as general-purpose in Claude Code.
        type: typeof obj.type === 'string' && obj.type !== '' ? obj.type : 'general-purpose',
        desc: typeof obj.desc === 'string' ? obj.desc : '',
      });
    }
    if (typeof obj.agent_id === 'string' && obj.agent_id !== '') agentIds.set(obj.agent_id, id);
    if (obj.status === 'done' || obj.status === 'failed') closed.add(id);
  }
  const mapped = new Set();
  for (const [agentId, id] of agentIds) {
    mapped.add(id);
    const entry = started.get(id);
    if (entry) byAgentId.set(agentId, entry.type);
  }
  for (const [id, entry] of started) {
    if (closed.has(id) || mapped.has(id)) continue;
    if (!byDesc.has(entry.desc)) byDesc.set(entry.desc, new Set());
    byDesc.get(entry.desc).add(entry.type);
  }
  return { byAgentId, byDesc };
}

// Read the session effort record written by writeSessionEffort. Returns the
// parsed object, or null when the file is missing, unreadable, corrupt, or not a
// JSON object. Never throws.
function readSessionEffort(sessionId) {
  const file = sessionEffortPath(sessionId);
  if (!file) return null;
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  return obj;
}

// ---------------------------------------------------------------------------
// SLICE 2 — Write-side helpers
// ---------------------------------------------------------------------------

// Append a single JSONL line to the per-session counter file.
// Best-effort: never throws to caller. mkdir -p for parent.
function counterAppend(sessionId, obj) {
  const file = counterPath(sessionId);
  if (!file) return;
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

// Persist the session's effort level and the Claude Code version that reported
// it. The statusline runs on every tick, so the file is rewritten only when its
// content would change. A missing level is stored as null so a stale value is
// cleared rather than left behind. Returns true when a write was attempted.
// Best-effort: never throws.
function writeSessionEffort(sessionId, effort, version) {
  const file = sessionEffortPath(sessionId);
  if (!file) return false;
  const record = JSON.stringify({
    effort: typeof effort === 'string' && effort !== '' ? effort : null,
    version: typeof version === 'string' && version !== '' ? version : null,
  });
  try {
    if (fs.readFileSync(file, 'utf8') === record) return false;
  } catch (_) { /* missing or unreadable: write below */ }
  atomicWrite(file, record);
  return true;
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
  safeSessionId,
  historyPath,
  counterPath,
  sessionStartPath,
  sessionEffortPath,
  // Atomic write
  atomicWrite,
  // Read helpers
  readCounters,
  findToolUseIdByAgentId,
  readDelegationTypes,
  readSessionEffort,
  // Write helpers (slice 2)
  counterAppend,
  historyAppend,
  historyTrimIfNeeded,
  writeSessionEffort,
  // Time
  nowIsoZ,
  nowEpochSeconds,
  isoToEpochSeconds,
};
