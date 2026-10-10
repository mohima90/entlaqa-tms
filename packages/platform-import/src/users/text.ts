import { normalizeDigits } from '@jadarat/platform-i18n';
import { unneutralizeFormula } from '../spreadsheet/csv';

/**
 * Text rules of the user import (T-M2-12): what a cell becomes before it is checked — the same rules as
 * the invite and edit forms (TM-0004 T-PEO-04: hidden direction-control and zero-width characters
 * removed, spaces collapsed, Eastern Arabic digits accepted where digits are expected).
 */

/**
 * Direction controls (LRM, RLM, ALM, embeddings, overrides, isolates), zero-width characters, the BOM
 * and the soft hyphen: never part of a name or an address.
 */
const HIDDEN = /[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** A cell as text: the quote our error report adds removed, hidden characters removed, spaces collapsed. */
export function cleanText(value: string): string {
  return unneutralizeFormula(value).replace(HIDDEN, '').replace(/\s+/g, ' ').trim();
}

/** Arabic diacritics (harakat, superscript alef) and tatweel. */
const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

/**
 * A key for comparing headers, role names and languages: lower case, Arabic letter variants folded
 * (أ إ آ ٱ → ا, ى → ي, ة → ه), diacritics and tatweel removed, punctuation and spaces dropped — the
 * rules of private.search_key, plus punctuation.
 */
export function matchKey(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** Digits in any script as ASCII digits. */
export function asciiDigits(value: string): string {
  return normalizeDigits(value);
}

/** Text of at most `max` characters for a message parameter (never a whole cell in a long text). */
export function excerpt(value: string, max = 60): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
