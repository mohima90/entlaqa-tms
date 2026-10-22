import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { UsersScreen } from '../../../../../../components/users/users-screen';

/**
 * Invite a user (T-M2-07, FR-IAM-03, BR-IAM-1): since redesign package 3 a side panel over Team members;
 * this address (the button, bookmarks, older links) opens the list with the panel open, the list's view
 * kept from the query string. HR Manager or Organization Admin (`platform.user.invite`); one role per
 * person (EP-ROLES), privileged roles only by the Organization Admin.
 */
export default async function InviteUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return <UsersScreen locale={locale} searchParams={await searchParams} invite />;
}
