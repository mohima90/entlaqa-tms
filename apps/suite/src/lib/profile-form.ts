/** My profile form helpers (FR-IAM-16) — shared by the page (server) and the form (client). */
export const NAME_PARTS = ['firstName', 'fatherName', 'grandfatherName', 'familyName'] as const;
export type NamePart = (typeof NAME_PARTS)[number];

export interface PersonalDetailsValues {
  readonly firstNameAr: string | null;
  readonly fatherNameAr: string | null;
  readonly grandfatherNameAr: string | null;
  readonly familyNameAr: string | null;
  readonly firstNameEn: string | null;
  readonly fatherNameEn: string | null;
  readonly grandfatherNameEn: string | null;
  readonly familyNameEn: string | null;
  readonly mobileE164: string | null;
  readonly preferredLocale: 'ar' | 'en';
}

/** Longest name part (database check). */
export const NAME_PART_MAX = 60;

export interface PersonalDetailsFormState {
  readonly values: PersonalDetailsValues;
  /** The display name was placed in "first name" (no parts yet) — the form says it can be split. */
  readonly prefilled: { readonly ar: boolean; readonly en: boolean };
}

/**
 * Initial form state. A person created before name parts existed (provisioning, sample data) has a
 * display name but no parts: the whole name goes into the first-name field (when it fits) so nothing
 * is lost on save and the member can split it.
 */
export function formStateFrom(
  details: PersonalDetailsValues & {
    readonly displayNameAr: string;
    readonly displayNameEn: string | null;
  },
): PersonalDetailsFormState {
  const prefill = (script: 'Ar' | 'En', displayName: string | null) =>
    displayName !== null &&
    displayName.length <= NAME_PART_MAX &&
    NAME_PARTS.every((part) => details[`${part}${script}`] === null);
  const ar = prefill('Ar', details.displayNameAr);
  const en = prefill('En', details.displayNameEn);
  return {
    values: {
      firstNameAr: ar ? details.displayNameAr : details.firstNameAr,
      fatherNameAr: details.fatherNameAr,
      grandfatherNameAr: details.grandfatherNameAr,
      familyNameAr: details.familyNameAr,
      firstNameEn: en ? details.displayNameEn : details.firstNameEn,
      fatherNameEn: details.fatherNameEn,
      grandfatherNameEn: details.grandfatherNameEn,
      familyNameEn: details.familyNameEn,
      mobileE164: details.mobileE164,
      preferredLocale: details.preferredLocale,
    },
    prefilled: { ar, en },
  };
}

/** Length of a display name composed from parts (as the server composes it). */
export function composedLength(parts: readonly string[]): number {
  return parts
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .join(' ').length;
}
