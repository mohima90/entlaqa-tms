import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound, redirect } from 'next/navigation';
import { cyclesHref } from '../../../../../../lib/planning-view';

/**
 * The old address of «New planning cycle» (a full page until WP-UX-01 a, T-M3-20): creating a cycle is a
 * popup on the cycles list now (forms standard rule 9), so the address opens the list with the popup. The
 * list authorizes the member (deny by default).
 */
export default async function NewPlanCyclePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  redirect(cyclesHref(locale, { open: { kind: 'new' } }));
}
