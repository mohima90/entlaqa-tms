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
  readonly displayNameAr: string;
  readonly displayNameEn: string | null;
}

/**
 * A display name stored without parts (provisioning, imports) and too long for the forms to pre-fill
 * into "first name" stays as it is when a save sends no parts for that script: a save that did not
 * touch the name never erases it. (A shorter one is pre-filled, so empty parts there mean "remove".)
 */
export function keepUnsplitDisplayNames<T extends NameFields>(before: NameFields, next: T): T {
  const noParts = (n: NameFields, script: 'Ar' | 'En') =>
    PARTS.every((part) => n[`${part}${script}`] === null);
  const unsplit = (script: 'Ar' | 'En', name: string | null) =>
    noParts(next, script) &&
    noParts(before, script) &&
    name !== null &&
    name.length > NAME_PART_MAX;
  let result = next;
  if (unsplit('Ar', before.displayNameAr)) {
    result = { ...result, displayNameAr: before.displayNameAr };
  }
  if (unsplit('En', before.displayNameEn)) {
    result = { ...result, displayNameEn: before.displayNameEn };
  }
  return result;
}
