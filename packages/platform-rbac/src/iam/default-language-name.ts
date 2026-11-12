import { type AppError, appError } from '@jadarat/platform-core';
import {
  type NamedOrgThing,
  type UserTx,
  getStoredNames,
  getTenantDefaultLocale,
} from '@jadarat/platform-db';
import { hasVisibleText } from '@jadarat/platform-i18n';
import { z } from 'zod';

/**
 * The names rule of the Organization pages (WP-UX-01 b, T-M3-21; forms standard rule 9; PO, 12 Nov 2026 — the
 * rule approved for people on 17 Oct 2026 and for planning cycles on 12 Nov 2026): a unit of the structure, a
 * branch, a structure level and a cost centre are named in the organization's default language; the other
 * language is optional. The database only refuses a row without any name (migration 20261113100000).
 */
export interface NamePair {
  readonly nameAr: string | null;
  readonly nameEn: string | null;
}

/**
 * One name of the pair as typed: may be empty (which one is required is the handler's rule — the organization
 * is known there). A given name is trimmed, within its length and has a visible character.
 */
export const nameInOneLanguage = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => value === '' || hasVisibleText(value), { message: 'invisible' })
    .transform((value) => (value === '' ? null : value));

/** The field of the name the organization's default language requires. */
export function defaultNameField(locale: 'ar' | 'en'): 'nameAr' | 'nameEn' {
  return locale === 'ar' ? 'nameAr' : 'nameEn';
}

/**
 * A VALIDATION_FAILED error with a REQUIRED field error on the missing default-language name (the forms show
 * it next to the field), or null when the rule is satisfied. With `stored` (an existing thing): a save that
 * leaves both names as they are passes whatever they are — things named before the rule, or before the
 * organization changed its default language, can still be saved, activated or deactivated (as people:
 * iam/my-profile.ts, PO decision 17 Oct 2026). Creating always applies the rule.
 */
export async function defaultNameError(
  tx: UserTx,
  names: NamePair,
  stored?: { readonly thing: NamedOrgThing; readonly id: string },
): Promise<AppError | null> {
  const field = defaultNameField(await getTenantDefaultLocale(tx));
  if (names[field] !== null) return null;
  if (stored) {
    const before = await getStoredNames(tx, stored.thing, stored.id);
    if (before?.nameAr === names.nameAr && before.nameEn === names.nameEn) return null;
  }
  return appError('VALIDATION_FAILED', { fieldErrors: [{ path: field, code: 'REQUIRED' }] });
}
