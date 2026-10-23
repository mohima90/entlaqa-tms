import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { isDomainError } from './domain-error';
import {
  compareGradeCodes,
  createGrade,
  deleteGrade,
  forgetPersonRecordPresenceForTests,
  getHrDetails,
  getPersonGrade,
  getPersonPhotoContent,
  getPersonPhotoFacts,
  listGrades,
  listGradesWithPeople,
  photoVersionOf,
  publishProfilePhoto,
  removeProfilePhoto,
  renameGrade,
  saveHrDetails,
  setPersonGrade,
} from './person-record';

const dialect = new PgDialect();

/** A transaction that answers each query in turn; catalog lookups (to_regclass) say present or absent. */
function fakeTx(results: (unknown[] | Error)[], absent = false) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        const q = dialect.sqlToQuery(query);
        if (q.sql.includes('to_regclass(')) return Promise.resolve([{ present: !absent }]);
        executed.push({ sql: q.sql, params: q.params });
        const next = results.shift() ?? [];
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    } as never,
  };
}

/** The migration has not run: the table lookups say absent (forget what earlier calls saw). */
function absent() {
  forgetPersonRecordPresenceForTests();
  return fakeTx([], true);
}

const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('db'), { cause: { code, message: '', ...extra } });
const isWrite = (q: { sql: string }) => /^\s*(insert|update|delete)\b/.test(q.sql);

const PERSON = 'a1000000-0000-4000-8000-000000000c01';
const GRADE = 'a8100000-0000-4000-8000-000000000001';

beforeEach(() => {
  forgetPersonRecordPresenceForTests();
});

describe('grade codes', () => {
  it('sort numbers numerically, then by text, ignoring case', () => {
    const sorted = ['G7', '#7', '10', '3', 'g6', '7', 'G-9'].sort(compareGradeCodes);
    expect(sorted).toEqual(['#7', '3', '7', '10', 'G-9', 'g6', 'G7']);
  });
});

describe('the grade list', () => {
  it('lists the codes in natural order', async () => {
    const { tx } = fakeTx([
      [
        { id: 'a', code: 'G7' },
        { id: 'b', code: '3' },
        { id: 'c', code: '10' },
      ],
    ]);
    expect((await listGrades(tx)).map((g) => g.code)).toEqual(['3', '10', 'G7']);
  });

  it('answers nothing before the migration ran (deploy window)', async () => {
    const { tx, executed } = absent();
    expect(await listGrades(tx)).toEqual([]);
    expect(await listGradesWithPeople(tx)).toEqual([]);
    expect(executed).toHaveLength(0);
  });

  it('counts the people on each grade for the Grades page', async () => {
    const { tx } = fakeTx([
      [
        { id: 'a', code: '7', people: 3 },
        { id: 'b', code: '3', people: 0 },
      ],
    ]);
    expect(await listGradesWithPeople(tx)).toEqual([
      { id: 'b', code: '3', people: 0 },
      { id: 'a', code: '7', people: 3 },
    ]);
  });

  it('adds a grade and maps the database refusals', async () => {
    const ok = fakeTx([[{ id: 'new', code: 'G-7' }]]);
    expect(await createGrade(ok.tx, 'G-7')).toEqual({ ok: true, id: 'new', code: 'G-7' });
    expect(ok.executed[0]?.params).toEqual(['G-7']);
    const cases: [string, Record<string, unknown>, string][] = [
      ['23505', { constraint_name: 'grades_tenant_code_uq' }, 'taken'],
      ['23514', { constraint_name: 'grades_code_check' }, 'invalid'],
      ['42501', {}, 'not_allowed'],
    ];
    for (const [code, extra, refusal] of cases) {
      const refused = fakeTx([pgError(code, extra)]);
      expect(await createGrade(refused.tx, 'x')).toEqual({ ok: false, refusal });
    }
    await expect(createGrade(fakeTx([pgError('XX000')]).tx, 'x')).rejects.toThrow();
  });

  it('renames without a write when the code is the same, and keeps the people', async () => {
    const same = fakeTx([[{ code: 'G7', people: 2 }]]);
    expect(await renameGrade(same.tx, GRADE, 'G7')).toEqual({
      ok: true,
      from: 'G7',
      to: 'G7',
      people: 2,
    });
    expect(same.executed.filter(isWrite)).toHaveLength(0);
    const renamed = fakeTx([[{ code: 'G7', people: 2 }], [{ id: GRADE }]]);
    expect(await renameGrade(renamed.tx, GRADE, 'G8')).toEqual({
      ok: true,
      from: 'G7',
      to: 'G8',
      people: 2,
    });
    expect(renamed.executed.filter(isWrite)).toHaveLength(1);
  });

  it('refuses a rename of an unknown grade, one the member may not change (RLS) and a taken code', async () => {
    expect(await renameGrade(fakeTx([[]]).tx, GRADE, 'X')).toEqual({
      ok: false,
      refusal: 'not_found',
    });
    expect(await renameGrade(fakeTx([[{ code: 'A', people: 0 }], []]).tx, GRADE, 'X')).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    const taken = fakeTx([
      [{ code: 'A', people: 0 }],
      pgError('23505', { constraint_name: 'grades_tenant_code_uq' }),
    ]);
    expect(await renameGrade(taken.tx, GRADE, 'B')).toEqual({ ok: false, refusal: 'taken' });
  });

  it('refuses to delete a grade people hold — with how many — and deletes an unused one', async () => {
    const held = fakeTx([[{ code: 'G7', people: 4 }]]);
    expect(await deleteGrade(held.tx, GRADE)).toEqual({ ok: false, refusal: 'in_use', people: 4 });
    expect(held.executed.filter(isWrite)).toHaveLength(0);
    const unused = fakeTx([[{ code: 'G9', people: 0 }], [{ id: GRADE }]]);
    expect(await deleteGrade(unused.tx, GRADE)).toEqual({ ok: true, code: 'G9' });
    expect(await deleteGrade(fakeTx([[]]).tx, GRADE)).toEqual({ ok: false, refusal: 'not_found' });
    expect(await deleteGrade(fakeTx([[{ code: 'G9', people: 0 }], []]).tx, GRADE)).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    // Given to someone between the check and the delete: the database says so.
    expect(
      await deleteGrade(fakeTx([[{ code: 'G9', people: 0 }], pgError('JG001')]).tx, GRADE),
    ).toEqual({ ok: false, refusal: 'in_use' });
  });
});

describe("a person's grade", () => {
  it('reads the grade the database lets the caller see', async () => {
    expect(await getPersonGrade(fakeTx([[{ id: GRADE, code: '7' }]]).tx, PERSON)).toEqual({
      id: GRADE,
      code: '7',
    });
    expect(await getPersonGrade(fakeTx([[]]).tx, PERSON)).toBeNull();
    expect(await getPersonGrade(absent().tx, PERSON)).toBeNull();
  });

  it('does nothing when the grade is the same', async () => {
    const { tx, executed } = fakeTx([[{ grade_id: GRADE, code: '7' }]]);
    expect(await setPersonGrade(tx, PERSON, GRADE)).toEqual({
      ok: true,
      change: { changed: false, from: '7', to: '7' },
    });
    expect(executed.filter(isWrite)).toHaveLength(0);
  });

  it('inserts, updates and clears, reporting the codes', async () => {
    const insert = fakeTx([[], [{ code: '7' }], []]);
    expect(await setPersonGrade(insert.tx, PERSON, GRADE)).toEqual({
      ok: true,
      change: { changed: true, from: null, to: '7' },
    });
    expect(insert.executed.at(-1)?.sql).toMatch(/insert into platform\.person_grades/);
    const update = fakeTx([
      [{ grade_id: 'old', code: '3' }],
      [{ code: '7' }],
      [{ person_id: PERSON }],
    ]);
    expect(await setPersonGrade(update.tx, PERSON, GRADE)).toEqual({
      ok: true,
      change: { changed: true, from: '3', to: '7' },
    });
    expect(update.executed.at(-1)?.sql).toMatch(/update platform\.person_grades/);
    const clear = fakeTx([[{ grade_id: GRADE, code: '7' }], []]);
    expect(await setPersonGrade(clear.tx, PERSON, null)).toEqual({
      ok: true,
      change: { changed: true, from: '7', to: null },
    });
    expect(clear.executed.at(-1)?.sql).toMatch(/delete from platform\.person_grades/);
  });

  it('refuses an unknown grade, a foreign key violation and a member who may not set grades', async () => {
    expect(await setPersonGrade(fakeTx([[], []]).tx, PERSON, GRADE)).toEqual({
      ok: false,
      refusal: 'invalid',
    });
    expect(
      await setPersonGrade(fakeTx([[], [{ code: '7' }], pgError('23503')]).tx, PERSON, GRADE),
    ).toEqual({
      ok: false,
      refusal: 'invalid',
    });
    expect(
      await setPersonGrade(fakeTx([[], [{ code: '7' }], pgError('42501')]).tx, PERSON, GRADE),
    ).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    // RLS filtered the update: not allowed.
    expect(
      await setPersonGrade(
        fakeTx([[{ grade_id: 'old', code: '3' }], [{ code: '7' }], []]).tx,
        PERSON,
        GRADE,
      ),
    ).toEqual({ ok: false, refusal: 'not_allowed' });
    expect(await setPersonGrade(absent().tx, PERSON, GRADE)).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
  });
});

describe('HR-only fields', () => {
  const NEXT = {
    gender: 'female',
    birthDate: '1990-02-28',
    employmentCategory: 'technical',
  } as const;

  it('reads the row the database returns (none: null)', async () => {
    expect(
      await getHrDetails(
        fakeTx([[{ gender: 'male', birth_date: '1980-01-02', employment_category: 'management' }]])
          .tx,
        PERSON,
      ),
    ).toEqual({ gender: 'male', birthDate: '1980-01-02', employmentCategory: 'management' });
    expect(await getHrDetails(fakeTx([[]]).tx, PERSON)).toBeNull();
    expect(await getHrDetails(absent().tx, PERSON)).toBeNull();
  });

  it('inserts a first row and names only the fields that changed — never values', async () => {
    const { tx, executed } = fakeTx([[{ present: 1 }], [], []]);
    const saved = await saveHrDetails(tx, PERSON, NEXT);
    expect(saved).toEqual({ ok: true, changed: ['gender', 'birthDate', 'employmentCategory'] });
    expect(executed.at(-1)?.sql).toMatch(/insert into platform\.person_hr_details/);
  });

  it('updates an existing row and skips the write when nothing changed', async () => {
    const row = { gender: 'female', birth_date: '1990-02-28', employment_category: 'operational' };
    const update = fakeTx([[{ present: 1 }], [row], [{ person_id: PERSON }]]);
    expect(await saveHrDetails(update.tx, PERSON, NEXT)).toEqual({
      ok: true,
      changed: ['employmentCategory'],
    });
    expect(update.executed.at(-1)?.sql).toMatch(/update platform\.person_hr_details/);
    const same = fakeTx([[{ present: 1 }], [{ ...row, employment_category: 'technical' }]]);
    expect(await saveHrDetails(same.tx, PERSON, NEXT)).toEqual({ ok: true, changed: [] });
    expect(same.executed.filter(isWrite)).toHaveLength(0);
  });

  it('refuses an impossible date, a missing person and a member without the permission', async () => {
    const date = fakeTx([
      [{ present: 1 }],
      [],
      pgError('23514', { constraint_name: 'person_hr_details_birth_date_check' }),
    ]);
    expect(await saveHrDetails(date.tx, PERSON, NEXT)).toEqual({
      ok: false,
      refusal: 'birth_date_invalid',
    });
    expect(await saveHrDetails(fakeTx([[]]).tx, PERSON, NEXT)).toEqual({
      ok: false,
      refusal: 'not_found',
    });
    expect(
      await saveHrDetails(fakeTx([[{ present: 1 }], [], pgError('42501')]).tx, PERSON, NEXT),
    ).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    // The row exists but RLS hid it from the update: not allowed.
    const filtered = fakeTx([
      [{ present: 1 }],
      [{ gender: 'male', birth_date: null, employment_category: null }],
      [],
    ]);
    expect(await saveHrDetails(filtered.tx, PERSON, NEXT)).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    expect(await saveHrDetails(absent().tx, PERSON, NEXT)).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
  });
});

describe('the profile photo', () => {
  const publication = {
    fileId: 'f1',
    sourceSha256: 'a'.repeat(64),
    sourceSize: 10,
    contentType: 'image/png',
    content: new Uint8Array([1, 2, 3]),
  };

  it('publishes the copy and returns the file name and whether a photo was replaced', async () => {
    const { tx, executed } = fakeTx([[{ file_name: 'me.png', replaced: true }]]);
    expect(await publishProfilePhoto(tx, publication)).toEqual({
      fileName: 'me.png',
      replaced: true,
    });
    expect(executed[0]?.sql).toMatch(/private\.publish_profile_photo/);
    expect(executed[0]?.params).toContain('a'.repeat(64));
  });

  it('turns the database refusals into domain errors', async () => {
    const unusable = await publishProfilePhoto(fakeTx([pgError('JP001')]).tx, publication).catch(
      (e: unknown) => e,
    );
    expect(isDomainError(unusable, 'PHOTO_NOT_USABLE')).toBe(true);
    for (const code of ['JB002', 'JB003']) {
      const mismatch = await publishProfilePhoto(fakeTx([pgError(code)]).tx, publication).catch(
        (e: unknown) => e,
      );
      expect(isDomainError(mismatch, 'PHOTO_MISMATCH')).toBe(true);
    }
    const before = await publishProfilePhoto(absent().tx, publication).catch((e: unknown) => e);
    expect(isDomainError(before, 'PHOTO_NOT_USABLE')).toBe(true);
    await expect(publishProfilePhoto(fakeTx([pgError('XX000')]).tx, publication)).rejects.toThrow();
  });

  it('removes the own photo and says which file (null: there was none)', async () => {
    expect(await removeProfilePhoto(fakeTx([[{ file_name: 'me.png' }]]).tx)).toBe('me.png');
    expect(await removeProfilePhoto(fakeTx([[]]).tx)).toBeNull();
    expect(await removeProfilePhoto(absent().tx)).toBeNull();
  });

  it('reads the facts and the bytes of a photo; the version is the start of the SHA-256', async () => {
    const facts = await getPersonPhotoFacts(
      fakeTx([[{ content_type: 'image/png', sha256: 'b'.repeat(64), byte_size: 4 }]]).tx,
      PERSON,
    );
    expect(facts).toEqual({ contentType: 'image/png', sha256: 'b'.repeat(64), byteSize: 4 });
    expect(await getPersonPhotoFacts(fakeTx([[]]).tx, PERSON)).toBeNull();
    const content = await getPersonPhotoContent(
      fakeTx([
        [{ content_type: 'image/webp', content: new Uint8Array([9]), sha256: 'c'.repeat(64) }],
      ]).tx,
      PERSON,
    );
    expect(content?.contentType).toBe('image/webp');
    expect(await getPersonPhotoContent(absent().tx, PERSON)).toBeNull();
    expect(photoVersionOf('d'.repeat(64))).toBe('d'.repeat(12));
    expect(photoVersionOf(null)).toBeNull();
    expect(photoVersionOf(undefined)).toBeNull();
  });
});
