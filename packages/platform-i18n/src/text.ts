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
