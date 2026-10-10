import type { Meta, StoryObj } from '@storybook/react-vite';
import { activeBrand } from '../../.storybook/brands';
import { localeOf } from '../../.storybook/theme-preview-kit';
import { Alert } from '../alert';
import { Card } from '../card';
import {
  COLOR_ROLES,
  type ColorMode,
  checkContrast,
  displayRatio,
  jadaratLmsTheme,
  jadaratTheme,
  resolveThemeColors,
} from '../theme';

/**
 * Theme preview (T-M2-04c): every colour role of the active brand and the contrast contract, computed
 * live for the selected Brand and Theme (light/dark). For an organization colour it also explains,
 * in plain words, where we had to use a darker or lighter shade to keep text readable (FR-ADM-07).
 */
const meta = {
  title: 'Theme preview/Colours and contrast',
  tags: ['brand-matrix'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** A colour code or ratio inside a sentence: kept in Latin order (`dir="ltr"`) in Arabic text. */
function Code({ children }: { readonly children: string }) {
  return <bdi dir="ltr">{children}</bdi>;
}

const COPY = {
  ar: {
    title: 'الألوان والتباين',
    brand: 'الهوية المعروضة',
    brands: {
      jadarat: 'جدارات: الشكل الحالي',
      'jadarat-lms': 'جدارات LMS: بانتظار المواد، فالقيم مطابقة للشكل الحالي',
      organization: 'لون المنشأة',
    },
    mode: { light: 'الوضع الفاتح', dark: 'الوضع الداكن' },
    chosen: 'اللون المختار',
    noAdjustment: 'استُخدم لون المنشأة كما هو في الوضعين.',
    adjusted: (mode: ColorMode, used: string, requested: string, ratio: string) => (
      <>
        الأزرار في {mode === 'light' ? 'الوضع الفاتح' : 'الوضع الداكن'} تستخدم درجة{' '}
        {mode === 'light' ? 'أغمق' : 'أفتح'} من اللون (<Code>{used}</Code> بدل{' '}
        <Code>{requested}</Code>) ليبقى نصها مقروءًا (تباين <Code>{`${ratio} : 1`}</Code>).
      </>
    ),
    roles: 'أدوار الألوان',
    contrast: 'فحص التباين (WCAG 2.2 AA)',
    summary: (pass: number, total: number) => `الأزواج الناجحة: ${pass} من ${total}`,
    columns: ['الزوج', 'المثال', 'النسبة', 'المطلوب', 'النتيجة'],
    pass: 'ناجح',
    fail: 'غير ناجح',
    on: 'على',
  },
  en: {
    title: 'Colours and contrast',
    brand: 'Brand shown',
    brands: {
      jadarat: 'Jadarat: current look',
      'jadarat-lms': 'Jadarat LMS: waiting for material, so the values equal the current look',
      organization: 'Organization colour',
    },
    mode: { light: 'Light mode', dark: 'Dark mode' },
    chosen: 'Chosen colour',
    noAdjustment: 'The organization colour is used as chosen in both modes.',
    adjusted: (mode: ColorMode, used: string, requested: string, ratio: string) => (
      <>
        Buttons in {mode} mode use a {mode === 'light' ? 'darker' : 'lighter'} shade of the colour (
        <Code>{used}</Code> instead of <Code>{requested}</Code>) so their text stays readable
        (contrast <Code>{`${ratio} : 1`}</Code>).
      </>
    ),
    roles: 'Colour roles',
    contrast: 'Contrast check (WCAG 2.2 AA)',
    summary: (pass: number, total: number) => `${pass} of ${total} pairs pass`,
    columns: ['Pair', 'Sample', 'Ratio', 'Needs', 'Result'],
    pass: 'Pass',
    fail: 'Fail',
    on: 'on',
  },
} as const;

function ColoursPage({ globals }: { globals: Record<string, unknown> }) {
  const locale = localeOf(globals);
  const t = COPY[locale];
  const mode: ColorMode = globals.theme === 'dark' ? 'dark' : 'light';
  const brand = activeBrand(globals);
  const colors =
    brand.id === 'organization' && brand.organization
      ? resolveThemeColors(jadaratTheme, mode, brand.organization.layer)
      : resolveThemeColors(brand.id === 'jadarat-lms' ? jadaratLmsTheme : jadaratTheme, mode);
  const results = checkContrast(colors, mode);
  const passed = results.filter((r) => r.pass).length;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <h1 className="m-0 text-2xl font-bold">{t.title}</h1>
      <p className="m-0 text-text-muted">
        {t.brand}: {t.brands[brand.id]} · {t.mode[mode]}
      </p>

      {brand.organization ? (
        <Card
          title={
            <>
              {t.chosen}: <Code>{brand.organization.input.primary}</Code>
            </>
          }
        >
          {brand.organization.adjustments.length === 0 ? (
            <p className="m-0">{t.noAdjustment}</p>
          ) : (
            <ul className="m-0 flex flex-col gap-2 ps-5">
              {brand.organization.adjustments
                .filter((a) => a.family === 'primary')
                .map((a) => (
                  <li key={a.mode}>
                    {t.adjusted(a.mode, a.used, a.requested, displayRatio(a.ratio))}
                  </li>
                ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card title={t.roles}>
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {COLOR_ROLES.map((role) => (
            <li key={role} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="size-10 shrink-0 rounded-md border border-border-strong"
                style={{ background: `var(--color-${role})` }}
              />
              <span className="flex min-w-0 flex-col">
                <code dir="ltr" className="font-mono text-sm">
                  {role}
                </code>
                <span dir="ltr" className="text-sm text-text-muted">
                  {colors[role]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t.contrast}>
        <Alert tone={passed === results.length ? 'success' : 'danger'}>
          {t.summary(passed, results.length)}
        </Alert>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-start text-sm">
            <thead className="bg-surface-sunken">
              <tr>
                {t.columns.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={`${r.fg}-${r.bg}`} className="border-t border-border">
                  <td className="px-3 py-2">
                    <code dir="ltr">{r.fg}</code> {t.on} <code dir="ltr">{r.bg}</code>
                  </td>
                  <td className="px-3 py-2">
                    {r.use === 'ui' ? (
                      <span
                        aria-hidden="true"
                        className="inline-block h-6 w-16 rounded-sm p-1"
                        style={{ background: `var(--color-${r.bg})` }}
                      >
                        <span
                          className="block size-full rounded-sm"
                          style={{ background: `var(--color-${r.fg})` }}
                        />
                      </span>
                    ) : (
                      <span
                        className="inline-block rounded-sm px-2 font-medium"
                        style={{
                          color: `var(--color-${r.fg})`,
                          background: `var(--color-${r.bg})`,
                        }}
                      >
                        {locale === 'ar' ? 'نص' : 'Text'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {displayRatio(r.ratio)}
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {r.min}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {r.pass ? `✓ ${t.pass}` : `✗ ${t.fail}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export const ColoursAndContrast: Story = {
  render: (_args, { globals }) => <ColoursPage globals={globals} />,
};
