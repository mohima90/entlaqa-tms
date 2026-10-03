import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook for @jadarat/ui (T-M1-A02; Development Plan §6.3, ADR 0007): every component in Arabic (RTL)
 * and English (LTR), light and dark. Toolbar globals set `lang`/`dir`/`data-theme` on <html>, exactly
 * like the app. `pnpm --filter @jadarat/ui storybook` (dev) · `build-storybook` (static, used by CI).
 */
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  core: { disableTelemetry: true },
  viteFinal: (vite) => ({ ...vite, plugins: [...(vite.plugins ?? []), tailwindcss()] }),
};

export default config;
