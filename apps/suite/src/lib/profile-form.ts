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

/**
 * Initial form values. A person created before name parts existed (provisioning, sample data) has a
 * display name but no parts: the whole name goes into the first-name field so nothing is lost on save
 * and the member can split it.
 */
export function formValuesFrom(
  details: PersonalDetailsValues & {
    readonly displayNameAr: string;
    readonly displayNameEn: string | null;
  },
): PersonalDetailsValues {
  const noParts = (script: 'Ar' | 'En') =>
    NAME_PARTS.every((part) => details[`${part}${script}`] === null);
  return {
    firstNameAr: noParts('Ar') ? details.displayNameAr : details.firstNameAr,
    fatherNameAr: details.fatherNameAr,
    grandfatherNameAr: details.grandfatherNameAr,
    familyNameAr: details.familyNameAr,
    firstNameEn: noParts('En') ? details.displayNameEn : details.firstNameEn,
    fatherNameEn: details.fatherNameEn,
    grandfatherNameEn: details.grandfatherNameEn,
    familyNameEn: details.familyNameEn,
    mobileE164: details.mobileE164,
    preferredLocale: details.preferredLocale,
  };
}
