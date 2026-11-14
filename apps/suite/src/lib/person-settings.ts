/**
 * A person's settings sections (WP-UX-01 e, T-M3-21; FR-IAM-01): the former «Edit details» panel as tabs of
 * the person's page — helpers shared by the page (server) and the form (client).
 */

/** The settings sections of a person's page, in the order of the side tabs. */
export const PERSON_SETTINGS_TABS = ['personal', 'work'] as const;
export type PersonSettingsTab = (typeof PERSON_SETTINGS_TABS)[number];

export function isPersonSettingsTab(value: string): value is PersonSettingsTab {
  return (PERSON_SETTINGS_TABS as readonly string[]).includes(value);
}

/** Where `/users/[id]/edit` (bookmarks, older links) leads: the section asked for, else «Personal details». */
export function editRedirectTab(raw: string | string[] | undefined): PersonSettingsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && isPersonSettingsTab(value) ? value : 'personal';
}

/** The fields of the two sections as the form holds them (every value a string). */
export interface PersonFormState {
  readonly firstNameAr: string;
  readonly fatherNameAr: string;
  readonly grandfatherNameAr: string;
  readonly familyNameAr: string;
  readonly firstNameEn: string;
  readonly fatherNameEn: string;
  readonly grandfatherNameEn: string;
  readonly familyNameEn: string;
  readonly email: string;
  readonly mobile: string;
  readonly preferredLocale: 'ar' | 'en';
  readonly employeeNumber: string;
  readonly hireOn: string;
  readonly jobTitleAr: string;
  readonly jobTitleEn: string;
  readonly departmentId: string;
  readonly branchId: string;
  readonly costCentreId: string;
  readonly managerPersonId: string;
  readonly gradeId: string;
  readonly gender: '' | 'male' | 'female';
  readonly birthDate: string;
  readonly category: '' | 'management' | 'professional' | 'technical' | 'operational';
}

/** The fields whose value differs between two copies (names only, never values). */
export function changedKeys(
  from: PersonFormState,
  to: PersonFormState,
): readonly (keyof PersonFormState)[] {
  return (Object.keys(from) as (keyof PersonFormState)[]).filter((key) => from[key] !== to[key]);
}

/** The fields saved with the grade or the HR-only details (the other action), not with the account. */
export const RECORD_KEYS: readonly (keyof PersonFormState)[] = [
  'gradeId',
  'gender',
  'birthDate',
  'category',
];

/**
 * The person's version token («person:membership», two counters that only grow) as one number that grows
 * with either: what `useFormBase` compares to know that the page loaded a newer copy.
 */
export function personVersionNumber(token: string): number {
  const [person = '0', membership = '0'] = token.split(':');
  const value = Number(person) + Number(membership);
  return Number.isFinite(value) ? value : 0;
}
