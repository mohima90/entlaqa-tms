import 'server-only';
import { sql } from 'drizzle-orm';
import type { ClaimsTx } from './claims-tx';
import { DomainError } from './domain-error';
import { pgError } from './pg-error';
import type { UserTx } from './with-user-tx';

/**
 * The person record's additions of WP-ADM-04 (FR-IAM-16, FR-IAM-01, FR-IAM-02; business flow
 * EP-PEOPLE-photo-hr-fields, PO answers 21 and 23 Oct 2026): grades (the organization's list and a person's
 * grade), the HR-only fields (gender, date of birth, employment category) and the profile photo. The DATABASE
 * decides who reads and writes each (platform.grades / person_grades / person_hr_details / person_photos,
 * migrations 20261025100100-100300): a read the caller may not make returns no row, a write they may not make
 * is refused. The actions in platform-rbac authorize first and map the refusals to messages.
 *
 * Expand-first: until the migrations ran, every read answers «nothing» (the deploy window of the app and the
 * database in parallel) and every write is refused as not allowed.
 */

const present = new Map<string, boolean>();

/** Does the relation exist yet (a catalog lookup, never a failing query)? Remembered once seen. */
async function relationExists(tx: ClaimsTx, name: string): Promise<boolean> {
  if (present.get(name) === true) return true;
  const [row] = await tx.execute<{ present: boolean }>(
    sql`select to_regclass(${name}) is not null as present`,
  );
  const exists = row?.present === true;
  if (exists) present.set(name, true);
  return exists;
}

/** Tests only: forget what was seen. */
export function forgetPersonRecordPresenceForTests(): void {
  present.clear();
}

/** The photos table exists (the lists join it). */
export function personPhotosExist(tx: ClaimsTx): Promise<boolean> {
  return relationExists(tx, 'platform.person_photos');
}

// ---------------------------------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------------------------------

export interface GradeOption {
  readonly id: string;
  readonly code: string;
}

export interface GradeRow extends GradeOption {
  /** People holding it (read by those who manage grades; the database shows nobody else's). */
  readonly people: number;
}

/** 3, 4, 5, G6, G7, #7 … numbers in numeric order, then by text (case-insensitively). */
export function compareGradeCodes(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

/** The organization's grade codes, in natural order (every member reads them: a select list). */
export async function listGrades(tx: ClaimsTx): Promise<readonly GradeOption[]> {
  if (!(await relationExists(tx, 'platform.grades'))) return [];
  const rows = await tx.execute<{ id: string; code: string }>(
    sql`select g.id, g.code from platform.grades g`,
  );
  return rows
    .map((r) => ({ id: r.id, code: r.code }))
    .sort((a, b) => compareGradeCodes(a.code, b.code));
}

/** The list with the number of people on each (for HR and the Organization Admin: Grades page). */
export async function listGradesWithPeople(tx: ClaimsTx): Promise<readonly GradeRow[]> {
  if (!(await relationExists(tx, 'platform.grades'))) return [];
  const rows = await tx.execute<{ id: string; code: string; people: number }>(sql`
    select g.id, g.code,
           (select count(*)::int from platform.person_grades pg
            where pg.tenant_id = g.tenant_id and pg.grade_id = g.id) as people
    from platform.grades g`);
  return rows
    .map((r) => ({ id: r.id, code: r.code, people: r.people }))
    .sort((a, b) => compareGradeCodes(a.code, b.code));
}

export type GradeRefusal = 'not_found' | 'taken' | 'invalid' | 'in_use' | 'not_allowed';

export type GradeOutcome<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly refusal: GradeRefusal; readonly people?: number };

/** Database refusals of a grade change → reasons; rethrows the rest. */
function gradeRefusal(error: unknown): GradeRefusal {
  const pg = pgError(error);
  if (pg?.code === '23505' && pg.constraint === 'grades_tenant_code_uq') return 'taken';
  if (pg?.code === '23514' && pg.constraint === 'grades_code_check') return 'invalid';
  if (pg?.code === 'JG001' || pg?.code === '23503') return 'in_use';
  if (pg?.code === '42501') return 'not_allowed';
  throw error;
}

/** Adds a grade code. A refusal aborts the transaction (the action's error result rolls it back). */
export async function createGrade(
  tx: UserTx,
  code: string,
): Promise<GradeOutcome<{ readonly id: string; readonly code: string }>> {
  if (!(await relationExists(tx, 'platform.grades'))) return { ok: false, refusal: 'not_allowed' };
  try {
    const [row] = await tx.execute<{ id: string; code: string }>(
      sql`insert into platform.grades (code) values (${code}) returning id, code`,
    );
    return row ? { ok: true, id: row.id, code: row.code } : { ok: false, refusal: 'not_allowed' };
  } catch (error) {
    return { ok: false, refusal: gradeRefusal(error) };
  }
}

/** Renames a grade; the people on it keep it (they show the new code). */
export async function renameGrade(
  tx: UserTx,
  id: string,
  code: string,
): Promise<GradeOutcome<{ readonly from: string; readonly to: string; readonly people: number }>> {
  if (!(await relationExists(tx, 'platform.grades'))) return { ok: false, refusal: 'not_found' };
  const [before] = await tx.execute<{ code: string; people: number }>(sql`
    select g.code, (select count(*)::int from platform.person_grades pg
                    where pg.tenant_id = g.tenant_id and pg.grade_id = g.id) as people
    from platform.grades g where g.id = ${id}::uuid`);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.code === code) return { ok: true, from: code, to: code, people: before.people };
  try {
    const updated = await tx.execute(
      sql`update platform.grades set code = ${code} where id = ${id}::uuid returning id`,
    );
    // RLS filtered the row: the member does not manage grades.
    if (updated.length === 0) return { ok: false, refusal: 'not_allowed' };
    return { ok: true, from: before.code, to: code, people: before.people };
  } catch (error) {
    return { ok: false, refusal: gradeRefusal(error) };
  }
}

/** Deletes a grade nobody holds; one people still hold is refused with how many (`in_use`). */
export async function deleteGrade(
  tx: UserTx,
  id: string,
): Promise<GradeOutcome<{ readonly code: string }>> {
  if (!(await relationExists(tx, 'platform.grades'))) return { ok: false, refusal: 'not_found' };
  const [row] = await tx.execute<{ code: string; people: number }>(sql`
    select g.code, (select count(*)::int from platform.person_grades pg
                    where pg.tenant_id = g.tenant_id and pg.grade_id = g.id) as people
    from platform.grades g where g.id = ${id}::uuid`);
  if (!row) return { ok: false, refusal: 'not_found' };
  if (row.people > 0) return { ok: false, refusal: 'in_use', people: row.people };
  try {
    const deleted = await tx.execute(
      sql`delete from platform.grades where id = ${id}::uuid returning id`,
    );
    if (deleted.length === 0) return { ok: false, refusal: 'not_allowed' };
    return { ok: true, code: row.code };
  } catch (error) {
    return { ok: false, refusal: gradeRefusal(error) };
  }
}

/** A person's grade as the caller may see it (null: none, or not for this caller's eyes). */
export async function getPersonGrade(tx: ClaimsTx, personId: string): Promise<GradeOption | null> {
  if (!(await relationExists(tx, 'platform.person_grades'))) return null;
  const [row] = await tx.execute<{ id: string; code: string }>(sql`
    select g.id, g.code from platform.person_grades pg
    join platform.grades g on g.tenant_id = pg.tenant_id and g.id = pg.grade_id
    where pg.person_id = ${personId}::uuid`);
  return row ? { id: row.id, code: row.code } : null;
}

export interface GradeChange {
  readonly changed: boolean;
  /** The codes before and after (null: no grade). Codes are not personal data. */
  readonly from: string | null;
  readonly to: string | null;
}

/** Sets (or, with null, clears) a person's grade. Only members who manage grades (the database checks). */
export async function setPersonGrade(
  tx: UserTx,
  personId: string,
  gradeId: string | null,
): Promise<
  | { readonly ok: true; readonly change: GradeChange }
  | { readonly ok: false; readonly refusal: 'invalid' | 'not_allowed' }
> {
  if (!(await relationExists(tx, 'platform.person_grades'))) {
    return { ok: false, refusal: 'not_allowed' };
  }
  const [current] = await tx.execute<{ grade_id: string; code: string }>(sql`
    select pg.grade_id, g.code from platform.person_grades pg
    join platform.grades g on g.tenant_id = pg.tenant_id and g.id = pg.grade_id
    where pg.person_id = ${personId}::uuid`);
  if ((current?.grade_id ?? null) === gradeId) {
    return {
      ok: true,
      change: { changed: false, from: current?.code ?? null, to: current?.code ?? null },
    };
  }
  try {
    let to: string | null = null;
    if (gradeId === null) {
      // Nothing removed (RLS filtered the row: the member does not manage grades) is not a change to report.
      const removed = await tx.execute(
        sql`delete from platform.person_grades where person_id = ${personId}::uuid returning person_id`,
      );
      if (removed.length === 0) return { ok: false, refusal: 'not_allowed' };
    } else {
      const [grade] = await tx.execute<{ code: string }>(
        sql`select g.code from platform.grades g where g.id = ${gradeId}::uuid`,
      );
      if (!grade) return { ok: false, refusal: 'invalid' };
      to = grade.code;
      if (current) {
        const updated = await tx.execute(sql`update platform.person_grades
          set grade_id = ${gradeId}::uuid where person_id = ${personId}::uuid returning person_id`);
        if (updated.length === 0) return { ok: false, refusal: 'not_allowed' };
      } else {
        // A first assignment that races another save of the same person does not fail on the key: the later
        // save wins, as an update would.
        await tx.execute(sql`insert into platform.person_grades (person_id, grade_id)
          values (${personId}::uuid, ${gradeId}::uuid)
          on conflict (tenant_id, person_id) do update set grade_id = excluded.grade_id`);
      }
    }
    return { ok: true, change: { changed: true, from: current?.code ?? null, to } };
  } catch (error) {
    const pg = pgError(error);
    if (pg?.code === '23503') return { ok: false, refusal: 'invalid' };
    if (pg?.code === '42501') return { ok: false, refusal: 'not_allowed' };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------
// HR-only fields
// ---------------------------------------------------------------------------------------------------

export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];
export const EMPLOYMENT_CATEGORIES = [
  'management',
  'professional',
  'technical',
  'operational',
] as const;
export type EmploymentCategory = (typeof EMPLOYMENT_CATEGORIES)[number];

export interface HrDetails {
  readonly gender: Gender | null;
  /** Gregorian, `YYYY-MM-DD`. */
  readonly birthDate: string | null;
  readonly employmentCategory: EmploymentCategory | null;
}

export const EMPTY_HR_DETAILS: HrDetails = {
  gender: null,
  birthDate: null,
  employmentCategory: null,
};

/** The field names of HR details, as the audit records them (never values). */
export type HrField = keyof HrDetails;

/**
 * A person's HR-only fields as the caller may see them: the person's own, or anyone's for a member holding
 * platform.person.hr_details. Nobody else gets a row (RLS) — the caller must already know whether they are
 * entitled, to tell «empty» from «not for you».
 */
export async function getHrDetails(tx: ClaimsTx, personId: string): Promise<HrDetails | null> {
  if (!(await relationExists(tx, 'platform.person_hr_details'))) return null;
  const [row] = await tx.execute<{
    gender: Gender | null;
    birth_date: string | null;
    employment_category: EmploymentCategory | null;
  }>(sql`select h.gender, h.birth_date::text as birth_date, h.employment_category
         from platform.person_hr_details h where h.person_id = ${personId}::uuid`);
  return row
    ? { gender: row.gender, birthDate: row.birth_date, employmentCategory: row.employment_category }
    : null;
}

export type HrDetailsOutcome =
  | { readonly ok: true; readonly changed: readonly HrField[] }
  | { readonly ok: false; readonly refusal: 'birth_date_invalid' | 'not_found' | 'not_allowed' };

const HR_COLUMNS: readonly (readonly [HrField, string])[] = [
  ['gender', 'gender'],
  ['birthDate', 'birth_date'],
  ['employmentCategory', 'employment_category'],
];

/**
 * Saves a person's HR-only fields (members holding platform.person.hr_details only — the database
 * refuses anyone else). Returns the changed field names, never values.
 */
export async function saveHrDetails(
  tx: UserTx,
  personId: string,
  next: HrDetails,
): Promise<HrDetailsOutcome> {
  if (!(await relationExists(tx, 'platform.person_hr_details'))) {
    return { ok: false, refusal: 'not_allowed' };
  }
  const [exists] = await tx.execute(
    sql`select 1 as present from platform.persons p where p.id = ${personId}::uuid`,
  );
  if (!exists) return { ok: false, refusal: 'not_found' };
  const before = await getHrDetails(tx, personId);
  const current = before ?? EMPTY_HR_DETAILS;
  const changed = HR_COLUMNS.filter(([field]) => current[field] !== next[field]).map(([f]) => f);
  if (changed.length === 0) return { ok: true, changed };
  try {
    if (before === null) {
      await tx.execute(sql`insert into platform.person_hr_details
          (person_id, gender, birth_date, employment_category)
        values (${personId}::uuid, ${next.gender}, ${next.birthDate}::date, ${next.employmentCategory})
        on conflict (tenant_id, person_id) do update
          set gender = excluded.gender, birth_date = excluded.birth_date,
              employment_category = excluded.employment_category`);
    } else {
      const updated = await tx.execute(sql`update platform.person_hr_details
        set gender = ${next.gender}, birth_date = ${next.birthDate}::date,
            employment_category = ${next.employmentCategory}
        where person_id = ${personId}::uuid returning person_id`);
      // RLS filtered the row: the member does not hold the permission.
      if (updated.length === 0) return { ok: false, refusal: 'not_allowed' };
    }
  } catch (error) {
    const pg = pgError(error);
    if (pg?.code === '23514' && pg.constraint === 'person_hr_details_birth_date_check') {
      return { ok: false, refusal: 'birth_date_invalid' };
    }
    if (pg?.code === '42501') return { ok: false, refusal: 'not_allowed' };
    if (pg?.code === '23503') return { ok: false, refusal: 'not_found' };
    throw error;
  }
  return { ok: true, changed };
}

// ---------------------------------------------------------------------------------------------------
// Profile photo
// ---------------------------------------------------------------------------------------------------

/** What the web app read from the person's own upload, ready to be published (platform-files). */
export interface ProfilePhotoPublication {
  readonly fileId: string;
  /** SHA-256 (hex) and size of the bytes read (the stored upload). */
  readonly sourceSha256: string;
  readonly sourceSize: number;
  /** The type detected by content. */
  readonly contentType: string;
  /** The copy shown to others: no EXIF/GPS, XMP, comments. */
  readonly content: Uint8Array;
}

/**
 * Stores the copy of the caller's OWN uploaded photo (private.publish_profile_photo): the upload becomes
 * `accepted` (not virus-scanned, PO 21 Oct 2026), the previous photo's copy is removed and its file deleted.
 * Returns the file name (for the audit event: never the picture) and whether a photo was replaced. Throws
 * DomainError PHOTO_NOT_USABLE (not the caller's usable upload) or PHOTO_MISMATCH (the bytes are not the stored
 * file's, or not an allowed image).
 */
export async function publishProfilePhoto(
  tx: UserTx,
  photo: ProfilePhotoPublication,
): Promise<{ readonly fileName: string; readonly replaced: boolean }> {
  if (!(await personPhotosExist(tx))) throw new DomainError('PHOTO_NOT_USABLE');
  try {
    const [row] = await tx.execute<{ file_name: string; replaced: boolean }>(sql`
      select file_name, replaced from private.publish_profile_photo(${photo.fileId}::uuid,
        ${photo.sourceSha256}, ${photo.sourceSize}::bigint, ${photo.contentType},
        ${Buffer.from(photo.content)}::bytea)`);
    if (!row) throw new DomainError('PHOTO_NOT_USABLE');
    return { fileName: row.file_name, replaced: row.replaced };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const code = pgError(error)?.code;
    if (code === 'JP001') throw new DomainError('PHOTO_NOT_USABLE', { cause: error });
    if (code === 'JB002' || code === 'JB003')
      throw new DomainError('PHOTO_MISMATCH', { cause: error });
    throw error;
  }
}

/** Removes the caller's own photo (copy at once, file deleted). The file name, or null when there was none. */
export async function removeProfilePhoto(tx: UserTx): Promise<string | null> {
  if (!(await personPhotosExist(tx))) return null;
  const [row] = await tx.execute<{ file_name: string }>(
    sql`select file_name from private.remove_profile_photo()`,
  );
  return row?.file_name ?? null;
}

/** A photo's facts (members read them): the cache key of its address and its type. */
export interface PersonPhotoFacts {
  readonly contentType: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export async function getPersonPhotoFacts(
  tx: ClaimsTx,
  personId: string,
): Promise<PersonPhotoFacts | null> {
  if (!(await personPhotosExist(tx))) return null;
  const [row] = await tx.execute<{ content_type: string; sha256: string; byte_size: number }>(sql`
    select ph.content_type, ph.sha256, ph.byte_size from platform.person_photos ph
    where ph.person_id = ${personId}::uuid`);
  return row
    ? { contentType: row.content_type, sha256: row.sha256, byteSize: row.byte_size }
    : null;
}

/** The bytes of a person's photo for a signed-in member of the same organization (null: none). */
export async function getPersonPhotoContent(
  tx: ClaimsTx,
  personId: string,
): Promise<{
  readonly contentType: string;
  readonly content: Uint8Array;
  readonly sha256: string;
} | null> {
  if (!(await personPhotosExist(tx))) return null;
  const [row] = await tx.execute<{ content_type: string; content: Uint8Array; sha256: string }>(
    sql`select content_type, content, sha256 from private.person_photo_content(${personId}::uuid)`,
  );
  return row ? { contentType: row.content_type, content: row.content, sha256: row.sha256 } : null;
}

/** The version in a photo's address (`?v=`): the first 12 characters of its SHA-256 (a new photo, a new address). */
export function photoVersionOf(sha256: string | null | undefined): string | null {
  return sha256 ? sha256.slice(0, 12) : null;
}
