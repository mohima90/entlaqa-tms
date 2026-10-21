import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { ProfileScreen, profileTab } from '../../../../../../../components/users/profile-screen';

/**
 * Change a member's role (T-M2-14, FR-IAM-07/08; EP-ROLES): since redesign package 3 the change-role side
 * panel over the profile (the same panel as on Team members); this address opens it. HR Manager (every
 * ordinary role) or Organization Admin (privileged roles too); editRolesQuery decides.
 */
export default async function EditRolesPage({
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
    <ProfileScreen locale={locale} personId={personId} tab={profileTab(tab)} panel={'roles'} />
  );
}
