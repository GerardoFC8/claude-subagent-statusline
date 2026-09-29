// scripts/lib/version.js — numeric comparison of Claude Code version strings.
//
// Versions must be compared per component as integers: a lexical comparison
// ranks "2.1.99" above "2.1.214". Only a leading MAJOR.MINOR.PATCH is read, so
// pre-release or build suffixes ("2.1.285-beta.1") are tolerated. Anything that
// does not start with three numeric components is treated as unknown.
'use strict';

const SEMVER_PREFIX = /^(\d+)\.(\d+)\.(\d+)/;

function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = SEMVER_PREFIX.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// True when `actual` is a parseable version at or above `minimum`. An unknown
// version returns false: callers use this as a feature gate, and "unknown" must
// not unlock behaviour that is only correct on newer releases.
function versionAtLeast(actual, minimum) {
  const a = parseVersion(actual);
  const b = parseVersion(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

module.exports = { parseVersion, versionAtLeast };
