import type { Decorator, Preview } from '@storybook/react-vite';
import { type ReactNode, useLayoutEffect } from 'react';
import './storybook.css';

type Locale = 'ar' | 'en';
type Theme = 'light' | 'dark';

/** Mirrors the app: `lang` + `dir` from the locale, `data-theme` for the colour theme, on <html>. */
function LocaleThemeFrame({
  locale,
  theme,
  children,
}: {
  readonly locale: Locale;
  readonly theme: Theme;
  readonly children: ReactNode;
}) {
  // Layout effect: applied before paint, so neither a person nor axe ever sees the previous direction.
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.lang = locale;
    html.dir = locale === 'ar' ? 'rtl' : 'ltr';
    html.dataset.theme = theme;
  }, [locale, theme]);
  return <div className="bg-bg p-6 text-text">{children}</div>;
}

const withLocaleAndTheme: Decorator = (Story, context) => (
  <LocaleThemeFrame
    locale={context.globals.locale === 'en' ? 'en' : 'ar'}
    theme={context.globals.theme === 'dark' ? 'dark' : 'light'}
  >
    <Story />
  </LocaleThemeFrame>
);

const preview: Preview = {
  decorators: [withLocaleAndTheme],
  initialGlobals: { locale: 'ar', theme: 'light' },
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
