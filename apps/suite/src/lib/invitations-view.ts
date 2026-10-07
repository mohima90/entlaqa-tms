/**
 * Invitations on the users list (T-M2-07, FR-IAM-03; screen 1 `invited` tab) — server-side helpers.
 */
import { normalizeDigits } from '@jadarat/platform-i18n';
import { type InvitationListItem, VALID_DAYS } from './invite-form';

/** Lower case, Western digits, Arabic letters folded (hamza forms, teh marbuta, alef maqsura). */
export function foldSearchText(value: string): string {
  return normalizeDigits(value)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // harakat and tatweel
    .replace(/[أإآ]/g, 'ا') // أ إ آ → ا
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/\s+/g, ' ')
    .trim();
}

export interface InvitationFilter {
  readonly q?: string | undefined;
  readonly role?: string | undefined;
  /** Invitations carry no department or branch: with these filters none match. */
  readonly department?: string | undefined;
  readonly branch?: string | undefined;
}

/** The invitations matching the users list's search and filters (name, e-mail; primary role). */
export function filterInvitations<T extends InvitationListItem>(
  rows: readonly T[],
  filter: InvitationFilter,
): readonly T[] {
  if (filter.department ?? filter.branch) return [];
  const q = filter.q ? foldSearchText(filter.q) : '';
  return rows.filter((row) => {
    if (filter.role && row.primaryRole !== filter.role) return false;
    if (!q) return true;
    const haystack = foldSearchText(`${row.displayNameAr} ${row.displayNameEn ?? ''} ${row.email}`);
    return haystack.includes(q);
  });
}

/** When a new invitation (or a resent link) expires: `days` after `now`. */
export function expiryFrom(now: Date, days: number = VALID_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
