import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { ProfileScreen, profileTab } from '../../../../../../components/users/profile-screen';

/**
 * A person's profile (T-M2-04 screen 3, FR-IAM-01/07; redesign package 3): the header with «Edit details»
 * and «Actions ▾», and the tabs Overview · Sign-in and security · Recent activity (`?tab=`).
 */
export default async function UserProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; personId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, personId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const { tab } = await searchParams;
  return <ProfileScreen locale={locale} personId={personId} tab={profileTab(tab)} panel={null} />;
}
