import 'server-only';
import { sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';

/**
 * Own personal details for My profile (FR-IAM-16). Only these columns are self-service; the database
 * guard (private.check_person_writer, T-M2-15a) refuses any other column on one's own record.
 */
export interface PersonalDetails {
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
  readonly mobileE164: string | null;
  readonly preferredLocale: 'ar' | 'en';
}

/** Field name → column, in a fixed order (also the order of `changed` in the audit event). */
const COLUMNS = {
  firstNameAr: 'first_name_ar',
  fatherNameAr: 'father_name_ar',
  grandfatherNameAr: 'grandfather_name_ar',
  familyNameAr: 'family_name_ar',
  firstNameEn: 'first_name_en',
  fatherNameEn: 'father_name_en',
  grandfatherNameEn: 'grandfather_name_en',
  familyNameEn: 'family_name_en',
  displayNameAr: 'display_name_ar',
  displayNameEn: 'display_name_en',
  mobileE164: 'mobile_e164',
  preferredLocale: 'preferred_locale',
} as const satisfies Record<keyof PersonalDetails, string>;

type Field = keyof PersonalDetails;
const FIELDS = Object.keys(COLUMNS) as Field[];

export async function getPersonalDetails(
  tx: UserTx,
  personId: string,
): Promise<PersonalDetails | null> {
  const [row] = await tx.execute<Record<string, string | null>>(sql`
    select first_name_ar, father_name_ar, grandfather_name_ar, family_name_ar,
           first_name_en, father_name_en, grandfather_name_en, family_name_en,
           display_name_ar, display_name_en, mobile_e164, preferred_locale
    from platform.persons where id = ${personId}::uuid`);
  if (!row) return null;
  return Object.fromEntries(
    FIELDS.map((f) => [f, row[COLUMNS[f]] ?? null]),
  ) as unknown as PersonalDetails;
}

/**
 * Saves the member's own personal details and returns the names of the fields that changed (for the
 * audit event — values are personal data and never go to the audit log). Null when the person is gone.
 */
export async function updatePersonalDetails(
  tx: UserTx,
  personId: string,
  details: PersonalDetails,
): Promise<readonly Field[] | null> {
  const before = await getPersonalDetails(tx, personId);
  if (!before) return null;
  const changed = FIELDS.filter((f) => before[f] !== details[f]);
  if (changed.length === 0) return [];
  await tx.execute(sql`
    update platform.persons set
      first_name_ar = ${details.firstNameAr}, father_name_ar = ${details.fatherNameAr},
      grandfather_name_ar = ${details.grandfatherNameAr}, family_name_ar = ${details.familyNameAr},
      first_name_en = ${details.firstNameEn}, father_name_en = ${details.fatherNameEn},
      grandfather_name_en = ${details.grandfatherNameEn}, family_name_en = ${details.familyNameEn},
      display_name_ar = ${details.displayNameAr}, display_name_en = ${details.displayNameEn},
      mobile_e164 = ${details.mobileE164}, preferred_locale = ${details.preferredLocale}
    where id = ${personId}::uuid`);
  return changed;
}
