import type { Decorator, Preview } from '@storybook/react-vite';
import { type ReactNode, useLayoutEffect } from 'react';
import {
  BRAND_IDS,
  type BrandId,
  DEFAULT_ORGANIZATION_COLOUR,
  SAMPLE_ORGANIZATION_COLOURS,
  activeBrand,
} from './brands';
import './storybook.css';

type Locale = 'ar' | 'en';
type Theme = 'light' | 'dark';

const BRAND_LAYER_ID = 'jadarat-brand-layer';

/**
 * Mirrors the app: `lang` + `dir` from the locale, `data-theme` for the colour theme, on <html>. The
 * brand (T-M2-04c theme preview) is a stylesheet loaded after the shipped theme, like a theme swap or
 * an organization's brand layer; `data-brand` records which one (for the story gate).
 */
function LocaleThemeFrame({
  locale,
  theme,
  brand,
  brandCss,
  children,
}: {
  readonly locale: Locale;
  readonly theme: Theme;
  readonly brand: BrandId;
  readonly brandCss: string;
  readonly children: ReactNode;
}) {
  // Layout effect: applied before paint, so neither a person nor axe ever sees the previous direction.
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.lang = locale;
    html.dir = locale === 'ar' ? 'rtl' : 'ltr';
    html.dataset.theme = theme;
    html.dataset.brand = brand;
    let layer = document.getElementById(BRAND_LAYER_ID);
    if (!brandCss) {
      layer?.remove();
      return;
    }
    if (!layer) {
      layer = document.createElement('style');
      layer.id = BRAND_LAYER_ID;
    }
    layer.textContent = brandCss;
    document.head.append(layer); // always last: wins over the shipped theme
  }, [locale, theme, brand, brandCss]);
  return <div className="bg-bg p-6 text-text">{children}</div>;
}

const withLocaleAndTheme: Decorator = (Story, context) => {
  const brand = activeBrand(context.globals);
  return (
    <LocaleThemeFrame
      locale={context.globals.locale === 'en' ? 'en' : 'ar'}
      theme={context.globals.theme === 'dark' ? 'dark' : 'light'}
      brand={brand.id}
      brandCss={brand.css}
    >
      <Story />
    </LocaleThemeFrame>
  );
};

const BRAND_TITLES: Record<BrandId, string> = {
  jadarat: 'Jadarat — current look (shipped)',
  'jadarat-lms': 'Jadarat LMS — waiting for material',
  organization: 'Organization colour (FR-ADM-07)',
};

const preview: Preview = {
  decorators: [withLocaleAndTheme],
  initialGlobals: {
    locale: 'ar',
    theme: 'light',
    brand: 'jadarat',
    brandColor: DEFAULT_ORGANIZATION_COLOUR,
  },
  globalTypes: {
    locale: {
      description: 'Language and direction',
      toolbar: {
        title: 'Language',
        icon: 'globe',
        items: [
          { value: 'ar', title: 'العربية (RTL)' },
          { value: 'en', title: 'English (LTR)' },
        ],
        dynamicTitle: true,
      },
    },
    theme: {
      description: 'Colour theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    brand: {
      description: 'Brand theme (T-M2-04c theme preview)',
      toolbar: {
        title: 'Brand',
        icon: 'paintbrush',
        items: BRAND_IDS.map((value) => ({ value, title: BRAND_TITLES[value] })),
        dynamicTitle: true,
      },
    },
    brandColor: {
      description: 'Organization colour (used when Brand = Organization colour)',
      toolbar: {
        title: 'Organization colour',
        icon: 'circle',
        items: SAMPLE_ORGANIZATION_COLOURS.map(({ value, title }) => ({ value, title })),
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
    // WCAG 2.2 AA, same rule set as the app's E2E gate (apps/suite/e2e/smoke.spec.ts).
    a11y: {
      options: { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      test: 'error',
    },
  },
};

export default preview;
