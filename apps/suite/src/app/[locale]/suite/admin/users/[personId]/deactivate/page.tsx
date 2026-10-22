import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { ProfileScreen, profileTab } from '../../../../../../../components/users/profile-screen';

/**
 * Deactivate a member (T-M2-09, FR-IAM-05): since redesign package 3 a dialog over the profile; this address
 * opens it. `platform.user.deactivate`; a privileged member only by the Organization Admin
 * (deactivationQuery decides).
 */
export default async function DeactivatePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; personId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, personId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const { tab } = await searchParams;
  return (
    <ProfileScreen locale={locale} personId={personId} tab={profileTab(tab)} panel={'deactivate'} />
  );
}
