import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound, permanentRedirect } from 'next/navigation';
import { SUITE_PATHS } from '../../../../../lib/suite-navigation';

/**
 * The former «Organization profile» address (T-M2-22): the page is now Settings → General (Kawadir
 * layout, T-M2-43). Bookmarks and links keep working through a permanent redirect; the new page
 * authorizes itself.
 */
export default async function OrganizationProfileRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  permanentRedirect(`/${locale}${SUITE_PATHS.general}`);
}
