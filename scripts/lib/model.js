// scripts/lib/model.js — shared model-id parser.
//
// Both statusline renderers need to turn a raw model id into a compact label
// ("Opus 4.8", "Haiku 4.5"), but they differ in what they can fall back to:
//
//   statusline.js          has `model.display_name` from the payload
//   subagent-statusline.js has nothing — the per-task payload carries no display name
//
// So this parser must NEVER invent a label from an id it does not recognise:
// returning null lets each caller pick its own fallback (display_name, or a dim
// placeholder). A parser that guesses would silently override a perfectly good
// display_name upstream.
'use strict';

// Trailing cloud-provider revision, e.g. the "-v1" in "...-sonnet-5-v1:0".
const REVISION_SUFFIX = /-v\d+$/;
// Trailing release snapshot, e.g. the "-20251001" in "claude-haiku-4-5-20251001".
const SNAPSHOT_SUFFIX = /-\d{8}$/;
const ALPHA_PART = /^[a-z]+$/i;
const NUMERIC_PART = /^\d+$/;

// Resolve a raw model id to a compact, human-readable label. Handles the id
// shapes Claude Code emits for both the main model and sub-agents:
//
//   claude-opus-4-8[1m]                          → "Opus 4.8"
//   claude-sonnet-5                              → "Sonnet 5"
//   claude-haiku-4-5-20251001                    → "Haiku 4.5"
//   claude-opus-4-1@20250805                     → "Opus 4.1"
//   us.anthropic.claude-sonnet-5-v1:0            → "Sonnet 5"
//   us.anthropic.claude-3-5-sonnet-20240620-v1:0 → "Sonnet 3.5"  (family after version)
//
// Returns null for anything that is not recognisably a Claude model id, so the
// caller can render its own fallback.
function parseModelFromId(id) {
  if (typeof id !== 'string' || id.trim() === '') return null;

  // Drop bracketed/parenthesised annotations such as "[1m]" or "(1M context)".
  let s = id.trim().replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').trim();

  // Require an explicit `claude-` marker. This is the guard that keeps the
  // parser from turning "gpt-4o-mini" into "Gpt 4o.mini".
  const at = s.lastIndexOf('claude-');
  if (at < 0) return null;
  s = s.slice(at).replace(/^claude-/, '');

  // Strip provider decorations, outermost first: ":0" / "@date" tails, then the
  // "-v1" revision, then the "-20240620" snapshot (revision wraps the snapshot).
  s = s.split(/[:@]/)[0];
  s = s.replace(REVISION_SUFFIX, '');
  s = s.replace(SNAPSHOT_SUFFIX, '');

  const parts = s.split('-').filter(Boolean);
  // The family is the first alphabetic segment — index 0 for "opus-4-8", but
  // index 2 for legacy Bedrock ids like "3-5-sonnet".
  const family = parts.find((p) => ALPHA_PART.test(p));
  if (!family) return null;

  const version = parts.filter((p) => NUMERIC_PART.test(p)).join('.');
  const Family = family.charAt(0).toUpperCase() + family.slice(1);
  return version ? `${Family} ${version}` : Family;
}

module.exports = { parseModelFromId };
