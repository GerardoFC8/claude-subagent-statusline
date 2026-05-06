// tests/_helpers.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

function mkTmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  return dir;
}

function cleanupTmpHome(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// Run a script file with stdin string, return { status, stdout, stderr }.
// envOverrides override HOME and any other env keys.
function runScript(scriptPath, stdinJson, envOverrides) {
  const env = Object.assign({}, process.env, envOverrides || {});
  const res = spawnSync(process.execPath, [scriptPath], {
    input: typeof stdinJson === 'string' ? stdinJson : JSON.stringify(stdinJson || ''),
    env,
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function readJsonl(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  return data.split('\n').filter(Boolean).map(JSON.parse);
}

function counterFile(home, sessionId) {
  return path.join(home, '.claude', 'state', `delegations-${sessionId}.jsonl`);
}

function sessionStartFile(home, sessionId) {
  return path.join(home, '.claude', 'state', `session-start-${sessionId}`);
}

module.exports = {
  REPO_ROOT,
  mkTmpHome,
  cleanupTmpHome,
  runScript,
  readJsonl,
  counterFile,
  sessionStartFile,
};
