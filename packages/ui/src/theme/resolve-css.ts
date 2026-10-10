/**
 * Resolves the design-token custom properties of our token stylesheets for one page context, the way
 * the browser does on <html>: which rules apply (selector + media query), the cascade (specificity, then
 * source order), then `var()` substitution. Used by tests to prove what the shipped CSS really sets
 * (golden snapshot, contrast of the shipped theme, tokens.json agreement).
 *
 * Deliberately small: it understands only the selectors and media queries our token files use and
 * throws on anything else, so a new pattern in the token files is a test failure, not a silent skip.
 */

export interface PageContext {
  /** `lang` on <html>. */
  readonly lang: 'ar' | 'en';
  /** `data-theme` on <html> (the app's explicit choice), or none (follow the system). */
  readonly dataTheme?: 'light' | 'dark' | undefined;
  /** `prefers-color-scheme: dark` (the system setting). */
  readonly prefersDark?: boolean | undefined;
  readonly prefersReducedMotion?: boolean | undefined;
}

interface Declaration {
  readonly name: string;
  readonly value: string;
  readonly order: number;
  readonly selectors: readonly string[];
  readonly media: readonly string[];
}

/** Does the selector match <html> in this context? */
const SELECTORS: Readonly<Record<string, (ctx: PageContext) => boolean>> = {
  ':root': () => true,
  ':root:lang(en)': (ctx) => ctx.lang === 'en',
  '[lang="en"]': (ctx) => ctx.lang === 'en',
  ':root:not([data-theme="light"])': (ctx) => ctx.dataTheme !== 'light',
  ':root[data-theme="dark"]': (ctx) => ctx.dataTheme === 'dark',
};
/** Specificity (a, b, c) packed as one number: these selectors only differ in b and c. */
const SPECIFICITY: Readonly<Record<string, number>> = {
  ':root': 10,
  ':root:lang(en)': 20,
  '[lang="en"]': 10,
  ':root:not([data-theme="light"])': 20,
  ':root[data-theme="dark"]': 20,
};
const MEDIA: Readonly<Record<string, (ctx: PageContext) => boolean>> = {
  '(prefers-color-scheme: dark)': (ctx) => ctx.prefersDark === true,
  '(prefers-reduced-motion: reduce)': (ctx) => ctx.prefersReducedMotion === true,
};

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Index of the brace closing the block that starts at `open` (a `{`). */
function closingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('Unbalanced braces in token CSS');
}

function parseBlock(
  css: string,
  media: readonly string[],
  out: Declaration[],
  counter: { n: number },
): void {
  let rest = css;
  for (;;) {
    const open = rest.indexOf('{');
    if (open === -1) {
      if (rest.trim() !== '') throw new Error(`Unexpected CSS outside a rule: ${rest.trim()}`);
      return;
    }
    const prelude = rest.slice(0, open).trim();
    const close = closingBrace(rest, open);
    const body = rest.slice(open + 1, close);
    rest = rest.slice(close + 1);
    if (prelude.startsWith('@media')) {
      const query = prelude.slice('@media'.length).trim();
      if (!MEDIA[query]) throw new Error(`Unknown media query in token CSS: ${query}`);
      parseBlock(body, [...media, query], out, counter);
      continue;
    }
    if (prelude.startsWith('@')) throw new Error(`Unsupported at-rule in token CSS: ${prelude}`);
    const selectors = prelude.split(',').map((s) => s.trim());
    for (const selector of selectors) {
      if (!SELECTORS[selector]) throw new Error(`Unknown selector in token CSS: ${selector}`);
    }
    for (const part of body.split(';')) {
      const colon = part.indexOf(':');
      if (colon === -1) {
        if (part.trim() !== '') throw new Error(`Bad declaration in token CSS: ${part.trim()}`);
        continue;
      }
      const name = part.slice(0, colon).trim();
      const value = part
        .slice(colon + 1)
        .trim()
        .replace(/\s+/g, ' ');
      out.push({ name, value, order: counter.n++, selectors, media });
    }
  }
}

/** Every declaration of the given stylesheets, in source order (later sheets come later). */
export function parseTokenCss(...sheets: readonly string[]): Declaration[] {
  const out: Declaration[] = [];
  const counter = { n: 0 };
  for (const sheet of sheets) parseBlock(stripComments(sheet), [], out, counter);
  return out;
}

/** Hex colours in lower case; everything else as written (whitespace collapsed). */
function normalize(value: string): string {
  return value.replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) => hex.toLowerCase());
}

function substitute(name: string, specified: Map<string, string>, stack: string[]): string {
  const raw = specified.get(name);
  if (raw === undefined) throw new Error(`Undefined custom property ${name}`);
  if (stack.includes(name))
    throw new Error(`Cyclic custom property ${[...stack, name].join(' → ')}`);
  return raw.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
    (_m, ref: string, fallback?: string) =>
      specified.has(ref) ? substitute(ref, specified, [...stack, name]) : (fallback ?? 'UNSET'),
  );
}

/**
 * Computed values of every custom property on <html> in the given context: applicable declarations →
 * cascade → `var()` substitution.
 */
export function resolveTokens(
  declarations: readonly Declaration[],
  ctx: PageContext,
): Record<string, string> {
  const winners = new Map<string, { specificity: number; order: number; value: string }>();
  for (const d of declarations) {
    if (!d.media.every((m) => MEDIA[m]?.(ctx))) continue;
    const matching = d.selectors.filter((s) => SELECTORS[s]?.(ctx));
    if (matching.length === 0) continue;
    const specificity = Math.max(...matching.map((s) => SPECIFICITY[s] ?? 0));
    const current = winners.get(d.name);
    if (
      !current ||
      specificity > current.specificity ||
      (specificity === current.specificity && d.order > current.order)
    ) {
      winners.set(d.name, { specificity, order: d.order, value: d.value });
    }
  }
  const specified = new Map([...winners].map(([name, w]) => [name, w.value]));
  const resolved: Record<string, string> = {};
  for (const name of [...specified.keys()].sort()) {
    resolved[name] = normalize(substitute(name, specified, []));
  }
  return resolved;
}

/** The contexts a token change must be checked in (light/dark × Arabic/English, both dark switches). */
export const PAGE_CONTEXTS: Readonly<Record<string, PageContext>> = {
  'light · ar': { lang: 'ar' },
  'light · en': { lang: 'en' },
  'dark (app setting) · ar': { lang: 'ar', dataTheme: 'dark' },
  'dark (app setting) · en': { lang: 'en', dataTheme: 'dark' },
  'dark (system) · ar': { lang: 'ar', prefersDark: true },
  'light (app setting, system dark) · ar': { lang: 'ar', dataTheme: 'light', prefersDark: true },
  'reduced motion · ar': { lang: 'ar', prefersReducedMotion: true },
};
