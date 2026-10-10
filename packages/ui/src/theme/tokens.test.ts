import { describe, expect, it } from 'vitest';
import { PAGE_CONTEXTS, parseTokenCss, resolveTokens } from './resolve-css';
import { shippedTokenSheets, tokensJson } from './shipped-tokens';

const declarations = () => parseTokenCss(...shippedTokenSheets().map((sheet) => sheet.css));

/**
 * Golden record of what the shipped token CSS resolves to on <html>, per context. Any change to a
 * token value shows up here as a snapshot diff — a refactor of the token files must leave it untouched
 * (only added tokens may appear); a deliberate look change (T-M2-04c) updates it with `vitest -u`.
 */
describe('shipped design tokens (golden record)', () => {
  for (const [name, ctx] of Object.entries(PAGE_CONTEXTS)) {
    it(`resolve to the recorded values: ${name}`, () => {
      expect(resolveTokens(declarations(), ctx)).toMatchSnapshot();
    });
  }
});

type Json = Record<string, unknown>;
interface Leaf {
  readonly path: string[];
  readonly value: unknown;
  readonly dark?: unknown;
}

function leaves(node: Json, path: string[] = []): Leaf[] {
  if ('$value' in node) {
    const modes = (node.$extensions as Json | undefined)?.['com.entlaqa.modes'] as Json | undefined;
    return [{ path, value: node.$value, dark: modes?.dark }];
  }
  return Object.entries(node)
    .filter(([key]) => !key.startsWith('$'))
    .flatMap(([key, child]) => leaves(child as Json, [...path, key]));
}

/** tokens.json path → [CSS custom property, mode]. */
function cssName(path: readonly string[]): [string, 'light' | 'dark'] {
  const [group, a, b] = path;
  switch (group) {
    case 'color':
      return [`--color-${a}-${b}`, 'light'];
    case 'semantic':
      return [`--color-${a}`, 'light'];
    case 'font':
      if (a === 'family') return [`--font-family-${b}`, 'light'];
      if (a === 'size') return [`--font-size-${b}-${path[3]}`, 'light'];
      if (a === 'weight') return [`--font-weight-${b}`, 'light'];
      return [`--${a}-${b}`, 'light'];
    case 'elevation':
      return [`--elevation-${b}`, a === 'dark' ? 'dark' : 'light'];
    case 'motion':
      return [`--${a}-${b}`, 'light'];
    case 'z-index':
      return [`--z-${a}`, 'light'];
    case 'breakpoint':
      return [`--bp-${a}`, 'light'];
    default:
      return [`--${group}-${a}`, 'light'];
  }
}

/** Comparable form of a tokens.json value: aliases resolved, lists and curves as CSS writes them. */
function canonical(value: unknown, root: Json): string {
  if (typeof value === 'string') {
    const alias = /^\{([\w.-]+)\}$/.exec(value);
    if (alias) {
      const target = (alias[1] ?? '')
        .split('.')
        .reduce<unknown>((node, key) => (node as Json)[key], root) as Json;
      return canonical(target.$value, root);
    }
    return value.toLowerCase().replace(/\s+/g, ' ');
  }
  if (Array.isArray(value)) {
    return typeof value[0] === 'number'
      ? `cubic-bezier(${value.join(', ')})`
      : value.map((v) => String(v).toLowerCase()).join(', ');
  }
  return String(value);
}

/** Comparable form of a resolved CSS value: quotes dropped, curve numbers normalized. */
function canonicalCss(value: string): string {
  return value
    .replace(/["']/g, '')
    .toLowerCase()
    .replace(
      /cubic-bezier\(([^)]*)\)/,
      (_m, args: string) =>
        `cubic-bezier(${args
          .split(',')
          .map((n) => String(Number(n)))
          .join(', ')})`,
    );
}

/** Active-script aliases and composites: defined in CSS only, documented in tokens.css itself. */
const CSS_ONLY =
  /^--(font-family-base|font-size-(xs|sm|md|lg|xl|2xl|3xl|4xl)|line-height-(body|heading)|letter-spacing-caps|focus-ring)$/;

describe('tokens.json (design documentation) agrees with the shipped CSS', () => {
  const json = tokensJson();
  const light = resolveTokens(declarations(), { lang: 'ar' });
  const dark = resolveTokens(declarations(), { lang: 'ar', dataTheme: 'dark' });

  it('has the same value for every documented token, light and dark', () => {
    const mismatches: string[] = [];
    for (const leaf of leaves(json)) {
      const [name, mode] = cssName(leaf.path);
      const css = (mode === 'dark' ? dark : light)[name];
      const expected = canonical(leaf.value, json);
      if (css === undefined || canonicalCss(css) !== canonicalCss(expected)) {
        mismatches.push(`${leaf.path.join('.')} → ${name}: json ${expected}, css ${css}`);
      }
      if (leaf.dark !== undefined) {
        const darkCss = dark[name];
        const darkExpected = canonical(leaf.dark, json);
        if (darkCss === undefined || canonicalCss(darkCss) !== canonicalCss(darkExpected)) {
          mismatches.push(
            `${leaf.path.join('.')} (dark) → ${name}: json ${darkExpected}, css ${darkCss}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('documents every token the CSS defines', () => {
    const documented = new Set(leaves(json).map((leaf) => cssName(leaf.path)[0]));
    // Custom properties only (`color-scheme` is a real property the theme sets per mode).
    const undocumented = Object.keys(light).filter(
      (name) => name.startsWith('--') && !documented.has(name) && !CSS_ONLY.test(name),
    );
    expect(undocumented).toEqual([]);
  });
});
