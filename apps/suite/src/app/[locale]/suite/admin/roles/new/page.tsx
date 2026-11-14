import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound, redirect } from 'next/navigation';

/** `standard:<code>` or `template:<key>`: what «Start from» may be opened with (untrusted). */
const START = /^(standard|template):[a-z][a-z0-9_]{1,39}$/;

/**
 * The former «Create role» page (FR-IAM-07). A role is now created in one popup on Roles & permissions (the
 * Kawadir pattern — forms standard rule 9; WP-UX-01 c, T-M3-21), and the builder opens as the new role's own
 * page: this address — bookmarks, and «Create a role from it» links of before — opens that popup, on the
 * same start. Who may create a role is decided there and by the action (`platform.role.manage`).
 */
export default async function NewRolePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const { from } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  const start = typeof from === 'string' && START.test(from) ? `&from=${from}` : '';
  redirect(`/${locale}/suite/admin/roles?new=1${start}`);
}
