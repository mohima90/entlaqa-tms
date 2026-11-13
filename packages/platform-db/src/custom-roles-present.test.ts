import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  englishOnlyNamesExist,
  forgetSchemaPresenceForTests,
  oneNameStructureExists,
  storableArabicDisplayName,
  storableStructureNames,
  structureLevelsExistCached,
} from './custom-roles-present';

const dialect = new PgDialect();

/** Answers each catalog question with the next `present` value; records the SQL asked. */
function catalog(...present: boolean[]) {
  const asked: string[] = [];
  const tx = {
    execute: (query: SQL) => {
      asked.push(dialect.sqlToQuery(query).sql);
      const next = present.shift();
      return Promise.resolve(next === undefined ? [] : [{ present: next }]);
    },
  };
  return { asked, tx: tx as never };
}

beforeEach(() => {
  forgetSchemaPresenceForTests();
});

describe('englishOnlyNamesExist (deploy window of 20261021090000)', () => {
  it('reads whether persons.display_name_ar still refuses NULL, and asks again until it does not', async () => {
    const db = catalog(false, false, true);
    await expect(englishOnlyNamesExist(db.tx)).resolves.toBe(false);
    await expect(englishOnlyNamesExist(db.tx)).resolves.toBe(false);
    await expect(englishOnlyNamesExist(db.tx)).resolves.toBe(true);
    expect(db.asked).toHaveLength(3);
    expect(db.asked[0]).toContain('not a.attnotnull');
    expect(db.asked[0]).toContain("a.attname = 'display_name_ar'");
    expect(db.asked[0]).toContain("to_regclass('platform.persons')");
  });

  it('is asked once per process once true (migrations only go forward)', async () => {
    const db = catalog(true);
    await expect(englishOnlyNamesExist(db.tx)).resolves.toBe(true);
    await expect(englishOnlyNamesExist(db.tx)).resolves.toBe(true);
    await expect(englishOnlyNamesExist(db.tx)).resolves.toBe(true);
    expect(db.asked).toHaveLength(1);
  });

  it('treats no answer as the old schema', async () => {
    await expect(englishOnlyNamesExist(catalog().tx)).resolves.toBe(false);
  });
});

describe('storableArabicDisplayName', () => {
  it('keeps a given Arabic name, and never asks the catalog for it', async () => {
    const db = catalog();
    await expect(storableArabicDisplayName(db.tx, 'سارة علي', 'Sara Ali')).resolves.toBe(
      'سارة علي',
    );
    await expect(storableArabicDisplayName(db.tx, null, null)).resolves.toBeNull();
    await expect(storableArabicDisplayName(db.tx, '', '')).resolves.toBeNull();
    expect(db.asked).toHaveLength(0);
  });

  it('before the migration: the English display name in the Arabic slot (the column refuses NULL)', async () => {
    await expect(storableArabicDisplayName(catalog(false).tx, null, 'Sara Ali')).resolves.toBe(
      'Sara Ali',
    );
    await expect(storableArabicDisplayName(catalog(false).tx, '', 'Sara Ali')).resolves.toBe(
      'Sara Ali',
    );
  });

  it('after it: no Arabic display name', async () => {
    await expect(storableArabicDisplayName(catalog(true).tx, null, 'Sara Ali')).resolves.toBeNull();
  });
});

describe('oneNameStructureExists / storableStructureNames (deploy window of 20261113100000)', () => {
  it('reads whether departments.name_ar still refuses NULL; asked once per process once it does not', async () => {
    const db = catalog(false, true);
    await expect(oneNameStructureExists(db.tx)).resolves.toBe(false);
    await expect(oneNameStructureExists(db.tx)).resolves.toBe(true);
    await expect(oneNameStructureExists(db.tx)).resolves.toBe(true);
    expect(db.asked).toHaveLength(2);
    expect(db.asked[0]).toContain('not a.attnotnull');
    expect(db.asked[0]).toContain("a.attname = 'name_ar'");
    expect(db.asked[0]).toContain("to_regclass('platform.departments')");
    forgetSchemaPresenceForTests();
    // No answer: the old schema.
    await expect(oneNameStructureExists(catalog().tx)).resolves.toBe(false);
  });

  it('before the migration: the given name fills the Arabic slot (levels: the English slot too)', async () => {
    const english = { nameAr: null, nameEn: 'Sales' };
    const arabic = { nameAr: 'المبيعات', nameEn: null };
    await expect(storableStructureNames(catalog(false).tx, english)).resolves.toEqual({
      nameAr: 'Sales',
      nameEn: 'Sales',
    });
    // A unit's and a branch's English name was optional already.
    await expect(storableStructureNames(catalog(false).tx, arabic)).resolves.toEqual(arabic);
    await expect(storableStructureNames(catalog(false).tx, arabic, true)).resolves.toEqual({
      nameAr: 'المبيعات',
      nameEn: 'المبيعات',
    });
  });

  it('after it: the names as given', async () => {
    const db = catalog(true);
    const english = { nameAr: null, nameEn: 'Sales' };
    await expect(storableStructureNames(db.tx, english)).resolves.toEqual(english);
    await expect(storableStructureNames(db.tx, english, true)).resolves.toEqual(english);
    expect(db.asked).toHaveLength(1);
  });
});

describe('structureLevelsExistCached', () => {
  it('asks until the levels exist, then never again', async () => {
    const db = catalog(false, true);
    await expect(structureLevelsExistCached(db.tx)).resolves.toBe(false);
    await expect(structureLevelsExistCached(db.tx)).resolves.toBe(true);
    await expect(structureLevelsExistCached(db.tx)).resolves.toBe(true);
    expect(db.asked).toHaveLength(2);
    expect(db.asked[0]).toContain("to_regclass('platform.structure_levels')");
  });
});
