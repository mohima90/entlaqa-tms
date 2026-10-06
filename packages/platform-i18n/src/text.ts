/**
 * Text helpers shared by the app and the database (ADR 0007 §5, §9).
 *
 * Digits: users may type Eastern Arabic (U+0660–U+0669) or Persian (U+06F0–U+06F9) digits; input is
 * normalized to ASCII before validation and search, so "١١٨٧" finds employee number 1187.
 */
const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

export function normalizeDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const zero = code >= PERSIAN_ZERO ? PERSIAN_ZERO : ARABIC_INDIC_ZERO;
    return String(code - zero);
  });
}

/**
 * Code points that do not count as visible text — the same list as the database check
 * private.has_visible_text (T-M2-01): white space, invisible and format marks (zero-width characters,
 * bidi marks and isolates, Arabic letter mark, soft hyphen, fillers, variation selectors, tags…).
 */
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00a0, 0x00a0],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x2800, 0x2800],
  [0x3000, 0x3000],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfffc, 0xfffc],
  [0xe0000, 0xe007f],
];

/** True when the text has at least one visible character (app-side twin of has_visible_text). */
export function hasVisibleText(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (/\s/.test(char)) continue;
    if (INVISIBLE_RANGES.some(([from, to]) => code >= from && code <= to)) continue;
    return true;
  }
  return false;
}
