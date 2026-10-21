import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { ProfileScreen, profileTab } from '../../../../../../../components/users/profile-screen';

/**
 * Edit a user's details (T-M2-13, FR-IAM-01): since redesign package 3 a side panel over the profile; this
 * address (bookmarks, older links) opens the profile with the panel open. HR Manager or Organization
 * Admin; a privileged member's record by the Organization Admin only (editUserQuery decides).
 */
export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; personId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, personId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const { tab } = await searchParams;
  return <ProfileScreen locale={locale} personId={personId} tab={profileTab(tab)} panel={'edit'} />;
}
