/**
 * People's names in two languages (FR-IAM-01; design principles §4) — the rule shared by every form that
 * enters a name (invite, edit details, My profile, bulk import, sign-up) and every place that shows one.
 *
 * The required name follows the organization's default language (guided-test feedback #2, PO 17 Oct 2026;
 * FR-ADM-02 `default_locale`): with English as the default (PO, 14 Oct 2026) the English first and family
 * names are required and shown first, the Arabic name is optional; with Arabic as the default it is the other
 * way round. The database keeps every person named (`persons_name_present_check`: an Arabic display name or a
 * complete English name).
 */
export type NameLanguage = 'ar' | 'en';

/** The four name fields a rule looks at (the father's and grandfather's names are always optional). */
export type RequiredNameField = 'firstNameAr' | 'familyNameAr' | 'firstNameEn' | 'familyNameEn';

export interface NamePairs {
  readonly firstNameAr?: string | null | undefined;
  readonly familyNameAr?: string | null | undefined;
  readonly firstNameEn?: string | null | undefined;
  readonly familyNameEn?: string | null | undefined;
}

/** The other language of the pair. */
export function otherNameLanguage(language: NameLanguage): NameLanguage {
  return language === 'ar' ? 'en' : 'ar';
}

/** The fields required when `language` is the organization's default: its first and family names. */
export function requiredNameFields(language: NameLanguage): readonly RequiredNameField[] {
  return language === 'ar' ? ['firstNameAr', 'familyNameAr'] : ['firstNameEn', 'familyNameEn'];
}

/**
 * The required name fields left empty (blank or only spaces), in form order; [] when the names satisfy the
 * rule of the organization's default language.
 */
export function missingNameFields(language: NameLanguage, names: NamePairs): RequiredNameField[] {
  return requiredNameFields(language).filter((field) => (names[field] ?? '').trim() === '');
}

/**
 * A person's name in the page's language, falling back to the other language when that one is missing (a
 * person may have only an English or only an Arabic name); '' only when neither exists.
 */
export function personDisplayName(
  locale: NameLanguage,
  nameAr: string | null | undefined,
  nameEn: string | null | undefined,
): string {
  const ar = nameAr?.trim() ? nameAr : null;
  const en = nameEn?.trim() ? nameEn : null;
  return (locale === 'en' ? (en ?? ar) : (ar ?? en)) ?? '';
}

/** The language of the name `personDisplayName` shows (for `lang`/`dir` on the element), or null. */
export function personDisplayNameLanguage(
  locale: NameLanguage,
  nameAr: string | null | undefined,
  nameEn: string | null | undefined,
): NameLanguage | null {
  const ar = Boolean(nameAr?.trim());
  const en = Boolean(nameEn?.trim());
  if (locale === 'en') return en ? 'en' : ar ? 'ar' : null;
  return ar ? 'ar' : en ? 'en' : null;
}
