import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound, redirect } from 'next/navigation';
import { editRedirectTab } from '../../../../../../../lib/person-settings';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Edit a user's details (T-M2-13, FR-IAM-01): since WP-UX-01 e (the Kawadir pattern) the details are the
 * «Personal details» and «Work details» tabs of the person's page; this address (bookmarks, older links)
 * leads there — to `?tab=work` when it asked for it, else to «Personal details». The page itself decides
 * who may edit (editUserQuery).
 */
export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; personId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, personId } = await params;
  if (!hasLocale(routing.locales, locale) || !UUID_RE.test(personId)) notFound();
  const { tab } = await searchParams;
  redirect(`/${locale}/suite/admin/users/${personId}?tab=${editRedirectTab(tab)}`);
}
