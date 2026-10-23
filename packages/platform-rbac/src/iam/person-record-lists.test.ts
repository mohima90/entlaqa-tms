import {
  EMPLOYMENT_CATEGORIES as DB_CATEGORIES,
  GENDERS as DB_GENDERS,
} from '@jadarat/platform-db';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EMPLOYMENT_CATEGORIES, GENDERS } from './person-record';

const migration = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261025100200_platform__create_person_hr_details.sql',
    import.meta.url,
  ),
  'utf8',
);

/** The fixed lists of R1 are written in three places: the database check, platform-db and here. */
describe('the HR-only lists (WP-ADM-04)', () => {
  it('are the same in the request path and in platform-db', () => {
    expect([...GENDERS]).toEqual([...DB_GENDERS]);
    expect([...EMPLOYMENT_CATEGORIES]).toEqual([...DB_CATEGORIES]);
  });

  it('are the ones the database accepts', () => {
    const list = (column: string) =>
      [
        ...(new RegExp(`${column} in \\(([^)]*)\\)`).exec(migration)?.[1] ?? '').matchAll(
          /'([a-z]+)'/g,
        ),
      ].map((m) => m[1]);
    expect(list('gender')).toEqual([...GENDERS]);
    expect(list('employment_category')).toEqual([...EMPLOYMENT_CATEGORIES]);
  });
});
