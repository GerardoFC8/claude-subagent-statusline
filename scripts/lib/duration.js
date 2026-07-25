// scripts/lib/duration.js — shared elapsed-duration formatter.
//
// Used by both renderers so the session clock and the per-subagent clock read
// identically: `45s`, `3m 12s`, `2h 5m`. Returns null for input that is not a
// finite number, letting each caller decide whether to omit the segment.
'use strict';

function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;

  // Clock skew between a payload timestamp and local time must never surface as
  // a negative duration, and fractional seconds must never leak into the label.
  let secs = Math.floor(seconds);
  if (secs < 0) secs = 0;

  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

module.exports = { formatDuration };
