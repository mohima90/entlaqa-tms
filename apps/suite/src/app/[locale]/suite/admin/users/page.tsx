import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { UsersScreen } from '../../../../../components/users/users-screen';

/**
 * Team members (T-M2-04 screen 1, FR-IAM-01; T-M2-07 invitations, T-M2-09 reactivation, T-M2-12 import,
 * EP-ROLES role changes; redesign package 3): view cards, the attention strip, instant filters, the members
 * with their quick look and ⋯ menu. Only the people the member may see (ADR 0003 §4.2).
 */
export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return <UsersScreen locale={locale} searchParams={await searchParams} invite={false} />;
}
