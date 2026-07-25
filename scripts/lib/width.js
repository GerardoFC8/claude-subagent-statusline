// scripts/lib/width.js — visible width measurement and width-safe truncation.
//
// String.length is the wrong ruler for a terminal. It counts UTF-16 code units,
// so a CJK character reports 1 while occupying 2 columns, and an emoji reports 2
// code units that must not be cut apart. Budgeting a statusline row with .length
// therefore both overflows on wide text and can emit a lone surrogate ('�').
'use strict';

const ANSI = /\x1b\[[0-9;]*m/g;
const ELLIPSIS = '…';

// Code-point ranges that render two columns wide. Covers the East Asian Wide and
// Fullwidth blocks plus the emoji planes — the cases that actually reach a
// statusline. Deliberately not a full Unicode width table: this is a rendering
// budget, and over-reserving a column is far cheaper than a wrapped row.
const WIDE_RANGES = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals, Kangxi, CJK Symbols
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, CJK Compatibility
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  // One span for the emoji planes: pictographs, emoticons, transport (🚀 is
  // U+1F680, outside the pictograph block), and supplemental symbols.
  [0x1f300, 0x1f9ff],
  [0x1fa70, 0x1faff], // Symbols and Pictographs Extended-A
  [0x20000, 0x3fffd], // CJK Extension B and beyond
];

// Combining marks attach to the previous glyph and occupy no column of their own.
const ZERO_WIDTH_RANGES = [
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0xfe00, 0xfe0f], // Variation selectors
];

function inRanges(cp, ranges) {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

function charWidth(cp) {
  if (inRanges(cp, ZERO_WIDTH_RANGES)) return 0;
  return inRanges(cp, WIDE_RANGES) ? 2 : 1;
}

// Rendered column count of a string, ignoring ANSI colour escapes.
function visibleWidth(s) {
  if (typeof s !== 'string') return 0;
  let w = 0;
  // Iterating a string yields whole code points, so surrogate pairs count once.
  for (const ch of s.replace(ANSI, '')) w += charWidth(ch.codePointAt(0));
  return w;
}

// Shorten `s` so it renders in at most `maxWidth` columns, appending `…` when
// anything was dropped. Cuts on code-point boundaries, never mid-surrogate.
function truncateToWidth(s, maxWidth) {
  if (typeof s !== 'string') return '';
  if (typeof maxWidth !== 'number' || !Number.isFinite(maxWidth) || maxWidth <= 0) return '';
  if (visibleWidth(s) <= maxWidth) return s;
  if (maxWidth === 1) return ELLIPSIS;

  // Reserve one column for the ellipsis, then take whole code points while they fit.
  const budget = maxWidth - 1;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out + ELLIPSIS;
}

module.exports = { visibleWidth, truncateToWidth };
