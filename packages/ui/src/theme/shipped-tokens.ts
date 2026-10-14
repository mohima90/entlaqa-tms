import { readFileSync } from 'node:fs';

/**
 * The token stylesheets the product actually ships: every `@import` of a design-token `.css` file
 * (docs/design/tokens/…) in `@jadarat/ui/styles.css`, in import order (test helper; Node only). The
 * font sheet (`./fonts.css`, only @font-face rules) is not a token sheet.
 */
export function shippedTokenSheets(): { path: string; css: string }[] {
  const stylesUrl = new URL('../styles.css', import.meta.url);
  const styles = readFileSync(stylesUrl, 'utf8');
  return [...styles.matchAll(/@import\s+'([^']+\/design\/tokens\/[^']+\.css)'/g)].map((match) => {
    const url = new URL(match[1] ?? '', stylesUrl);
    return { path: url.pathname, css: readFileSync(url, 'utf8') };
  });
}

/** docs/design/tokens/tokens.json (W3C DTCG), parsed. */
export function tokensJson(): Record<string, unknown> {
  const url = new URL('../../../../docs/design/tokens/tokens.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}
