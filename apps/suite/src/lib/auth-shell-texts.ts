import 'server-only';
import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { getTranslations } from 'next-intl/server';
import type { AuthPanelTexts, AuthShellTexts } from '../components/auth/auth-shell';

/** The frame texts of the public sign-in pages (AuthShell), translated on the server. */
export async function authShellTexts(locale: AppLocale): Promise<AuthShellTexts> {
  const common = await getTranslations({ locale, namespace: 'common' });
  const t = await getTranslations({ locale, namespace: 'auth.layout' });
  return {
    productName: common('productName'),
    portal: t('portal'),
    poweredBy: t('poweredBy'),
    entlaqa: t('entlaqa'),
  };
}

/** The sign-in page's brand panel: the product's promise and five features (no invented figures). */
export async function signInPanelTexts(locale: AppLocale): Promise<AuthPanelTexts> {
  const t = await getTranslations({ locale, namespace: 'auth.layout' });
  return {
    title: t('panelTitle'),
    accent: t('panelAccent'),
    text: t('panelText'),
    features: [
      { icon: 'key', text: t('features.plan') },
      { icon: 'clock', text: t('features.schedule') },
      { icon: 'userPlus', text: t('features.enroll') },
      { icon: 'check', text: t('features.assess') },
      { icon: 'link', text: t('features.report') },
    ],
  };
}

/** The floating language switch's target and texts for a locale-less path, e.g. "/sign-in". */
export async function authLanguageSwitch(
  locale: AppLocale,
  path: string,
): Promise<{ href: string; lang: string; label: string; ariaLabel: string }> {
  const common = await getTranslations({ locale, namespace: 'common' });
  const target = otherLocale(locale);
  return {
    href: `/${target}${path}`,
    lang: target,
    label: common('switchLanguage'),
    ariaLabel: common('switchLanguageAria'),
  };
}
