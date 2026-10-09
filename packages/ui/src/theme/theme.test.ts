import { describe, expect, it } from 'vitest';
import { displayRatio } from './color';
import { COLOR_ROLES, CONTRAST_PAIRS, CONTRAST_USE_LABEL, type ThemeDefinition } from './contract';
import { themeCss } from './css';
import { SHIPPED_THEME, THEMES } from './index';
import { type ContrastResult, checkTheme } from './resolve';

const isAlias = (value: string | undefined) => value?.startsWith('{semantic.') ?? false;

describe.each(THEMES.map((theme) => [theme.id, theme] as const))('theme «%s»', (_id, theme) => {
  it('defines every colour role, and a dark value for each role that is not an alias', () => {
    expect(Object.keys(theme.color.light).sort()).toEqual([...COLOR_ROLES].sort());
    const missingDark = COLOR_ROLES.filter(
      (role) => !isAlias(theme.color.light[role]) && theme.color.dark[role] === undefined,
    );
    expect(missingDark).toEqual([]);
  });

  it('passes every contrast pair of the contract in light and dark (WCAG 2.2 AA)', () => {
    const failures = checkTheme(theme)
      .filter((c) => !c.pass)
      .map((c) => `${c.mode}: ${c.fg} on ${c.bg} = ${displayRatio(c.ratio)} < ${c.min}`);
    expect(failures).toEqual([]);
  });

  it('generates valid CSS (every value is a colour, an alias or a scrim)', () => {
    expect(() => themeCss(theme)).not.toThrow();
  });
});

describe('theme slots waiting for design material', () => {
  const visual = (t: ThemeDefinition) => ({
    palette: t.palette,
    color: t.color,
    font: t.font,
    radius: t.radius,
    elevation: t.elevation,
  });
  it.each(THEMES.filter((t) => t.status === 'pending').map((t) => [t.id, t] as const))(
    '«%s» keeps the shipped look until the PO material arrives (no guessed values)',
    (_id, theme) => {
      expect(visual(theme)).toEqual(visual(SHIPPED_THEME));
    },
  );
});

describe('generated files', () => {
  it('docs/design/tokens/themes/jadarat.css is generated from the shipped theme', async () => {
    await expect(themeCss(SHIPPED_THEME)).toMatchFileSnapshot(
      '../../../../docs/design/tokens/themes/jadarat.css',
    );
  });

  it('docs/design/tokens/contrast-report.md is generated from the contract', async () => {
    await expect(contrastReport(SHIPPED_THEME)).toMatchFileSnapshot(
      '../../../../docs/design/tokens/contrast-report.md',
    );
  });
});

function contrastReport(theme: ThemeDefinition): string {
  const results = checkTheme(theme);
  const failures = results.filter((r) => !r.pass).length;
  const tightest = (rs: ContrastResult[]) =>
    rs.reduce((a, b) => (b.ratio / b.min < a.ratio / a.min ? b : a));
  const table = (mode: 'light' | 'dark') => {
    const rows = results.filter((r) => r.mode === mode);
    return [
      '| Foreground token | Background token | FG | BG | Ratio | Needs | Use | Pass |',
      '|---|---|---|---|---:|---:|---|---|',
      ...rows.map(
        (r) =>
          `| \`${r.fg}\` | \`${r.bg}\` | \`${r.fgColor}\` | \`${r.bgColor}\` | ${displayRatio(r.ratio)} | ${r.min.toFixed(1)} | ${CONTRAST_USE_LABEL[r.use]} | ${r.pass ? '✅' : '❌'} |`,
      ),
    ].join('\n');
  };
  const low = tightest(results);
  return `# Contrast report — Jadarat design tokens

> **Generated** by \`packages/ui/src/theme/theme.test.ts\` from the theme contract (\`packages/ui/src/theme/contract.ts\`) and the shipped theme «${theme.id}». Do not edit by hand; after a theme change run \`pnpm --filter @jadarat/ui exec vitest run -u\`. CI fails when this file is out of date or when any pair fails.

WCAG 2.x relative-luminance formula (\`(L1 + 0.05) / (L2 + 0.05)\`); ratios shown to 2 decimals, pass/fail decided on the exact ratio. Every text/background pair and every UI-component/background pair the components use is checked in **light** and **dark**.

| Requirement | Threshold | WCAG 2.2 SC |
|---|---|---|
| Normal text (all body, label, badge text) | ≥ 4.5 : 1 | 1.4.3 Contrast (Minimum) |
| Large text (≥ 24 px regular / ≥ 18.66 px bold) | ≥ 3 : 1 — we still hold all text to 4.5 : 1 | 1.4.3 |
| UI components and graphical objects (input borders, icons, focus ring) | ≥ 3 : 1 | 1.4.11 Non-text Contrast; 2.4.13 is AAA and not targeted |

**Result for «${theme.id}»: ${results.length - failures} of ${results.length} pairs pass (${failures} failures).** Tightest pair relative to its threshold: \`${low.fg}\` on \`${low.bg}\` (${low.mode}) = **${displayRatio(low.ratio)} : 1** (needs ${low.min}).

The same ${CONTRAST_PAIRS.length} pairs per mode are also checked automatically for:

- every theme in \`packages/ui/src/theme/themes/\` (including the pending «Jadarat LMS» slot);
- organization brand colours (FR-ADM-07): \`deriveOrganizationBrand\` derives the brand roles so that they always pass, re-checks all pairs and refuses to return a failing brand; its tests run it on hundreds of colours (white, black, pure yellow, mid greys, a colour grid and random colours).

Notes

- \`text-disabled\` is intentionally excluded (disabled controls are exempt under SC 1.4.3); disabled states must also be conveyed by the \`disabled\` attribute / \`aria-disabled\`.
- \`border\` (decorative divider) is intentionally below 3 : 1; it must never be the only boundary of an interactive control — inputs use \`border-strong\`.
- The focus ring is drawn as a 2 px ring separated from the component by a 2 px \`--color-bg\` gap (\`--focus-ring\`), so the ring is measured against \`bg\`/\`surface\` (and the header and navigation colours), not against the button fill.
- Accent and suite-shell roles (\`accent*\`, \`header*\`, \`nav*\`) are slots for the visual design round (T-M2-04c); in «jadarat» they are aliases of the primary and surface roles.

## Light theme

${table('light')}

## Dark theme

${table('dark')}
`;
}
