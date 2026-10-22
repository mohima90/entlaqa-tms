/**
 * Fills a raw message for client components (no i18n runtime in the browser): `{name}` and the number
 * forms `{name, number}` / `{name, number, integer}` get the value (numbers formatted for the locale).
 * Simple plural forms — `{name, plural, =0 {…} one {# day} two {…} few {…} many {…} other {# days}}`,
 * with `#` for the number — are chosen with the locale's plural rules (redesign package 4: reminder chips
 * and counts that change in the browser); select forms are never sent raw — the server formats those.
 */
const PLACEHOLDER = /\{(\w+)(?:, number(?:, integer)?)?\}/g;
const PLURAL_START = /\{(\w+), plural,/g;

function numberFormat(locale: string): Intl.NumberFormat {
  // As the server's formats (ADR 0007 §1): Western digits, the locale's separators.
  return new Intl.NumberFormat(`${locale === 'en' ? 'en' : 'ar'}-u-nu-latn`, {
    maximumFractionDigits: 1,
  });
}

/** The end of the `{…}` group that opens at `start` (depth counted), or -1. */
function groupEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Picks the branch of a plural form for a number. */
function pluralBranch(body: string, value: number, locale: string): string | null {
  const branches = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open === -1) break;
    const key = body.slice(i, open).trim();
    const close = groupEnd(body, open);
    if (close === -1) return null;
    branches.set(key, body.slice(open + 1, close));
    i = close + 1;
  }
  const rule = new Intl.PluralRules(locale === 'en' ? 'en' : 'ar').select(value);
  return branches.get(`=${String(value)}`) ?? branches.get(rule) ?? branches.get('other') ?? null;
}

function fillPlurals(
  template: string,
  values: Readonly<Record<string, string | number>>,
  locale: string,
): string {
  let out = '';
  let from = 0;
  PLURAL_START.lastIndex = 0;
  for (let match = PLURAL_START.exec(template); match; match = PLURAL_START.exec(template)) {
    const start = match.index;
    const end = groupEnd(template, start);
    const name = match[1] ?? '';
    const value = values[name];
    if (end === -1 || typeof value !== 'number') continue;
    const branch = pluralBranch(template.slice(start + match[0].length, end), value, locale);
    if (branch === null) continue;
    out += template.slice(from, start) + branch.replace(/#/g, numberFormat(locale).format(value));
    from = end + 1;
    PLURAL_START.lastIndex = from;
  }
  return out + template.slice(from);
}

export function fillText(
  template: string,
  values: Readonly<Record<string, string | number>>,
  locale = 'ar',
): string {
  const format = numberFormat(locale);
  return fillPlurals(template, values, locale).replace(PLACEHOLDER, (whole, name: string) => {
    if (!Object.hasOwn(values, name)) return whole;
    const value = values[name];
    return typeof value === 'number' ? format.format(value) : String(value);
  });
}
