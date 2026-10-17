/** Longest name part (database check `persons` name parts). */
export const NAME_PART_MAX = 60;

const PARTS = ['firstName', 'fatherName', 'grandfatherName', 'familyName'] as const;

export interface NameFields {
  readonly firstNameAr: string | null;
  readonly fatherNameAr: string | null;
  readonly grandfatherNameAr: string | null;
  readonly familyNameAr: string | null;
  readonly firstNameEn: string | null;
  readonly fatherNameEn: string | null;
  readonly grandfatherNameEn: string | null;
  readonly familyNameEn: string | null;
  readonly displayNameAr: string | null;
  readonly displayNameEn: string | null;
}

/**
 * A display name stored without parts (provisioning, imports) and too long for the forms to pre-fill
 * into "first name" stays as it is when a save sends no parts for that script: a save that did not
 * touch the name never erases it. (A shorter one is pre-filled, so empty parts there mean "remove".)
 */
export function keepUnsplitDisplayNames<T extends NameFields>(before: NameFields, next: T): T {
  let result = next;
  if (keepsUnsplitDisplayName(before, next, 'ar')) {
    result = { ...result, displayNameAr: before.displayNameAr };
  }
  if (keepsUnsplitDisplayName(before, next, 'en')) {
    result = { ...result, displayNameEn: before.displayNameEn };
  }
  return result;
}

type PartFields = Pick<
  NameFields,
  `${(typeof PARTS)[number]}${'Ar' | 'En'}` | 'displayNameAr' | 'displayNameEn'
>;

/**
 * Whether a save keeps the stored display name of that language as it is (see keepUnsplitDisplayNames):
 * then that language has a name although the form sent no parts — the required-name rule
 * (PO 17 Oct 2026) counts it as given.
 */
export function keepsUnsplitDisplayName(
  before: PartFields,
  next: Omit<PartFields, 'displayNameAr' | 'displayNameEn'>,
  language: 'ar' | 'en',
): boolean {
  const script = language === 'ar' ? 'Ar' : 'En';
  const noParts = (n: Omit<PartFields, 'displayNameAr' | 'displayNameEn'>) =>
    PARTS.every((part) => n[`${part}${script}`] === null);
  const name = language === 'ar' ? before.displayNameAr : before.displayNameEn;
  return noParts(next) && noParts(before) && name !== null && name.length > NAME_PART_MAX;
}
