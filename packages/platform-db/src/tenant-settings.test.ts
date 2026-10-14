import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  type OrganizationProfile,
  changedProfileFields,
  getOrganizationProfile,
  updateOrganizationProfile,
} from './tenant-settings';
import type { UserTx } from './with-user-tx';

const dialect = new PgDialect();

/** A transaction answering each statement with the next prepared result set. */
function fakeTx(...results: Record<string, unknown>[][]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: (query: SQL) => {
      executed.push(dialect.sqlToQuery(query));
      return Promise.resolve(results.shift() ?? []);
    },
  } as unknown as UserTx;
  return { tx, executed };
}

const row = {
  name_ar: 'شركة الراية',
  name_en: 'Al Raya Company',
  industry: 'banking_financial',
  country_code: 'SA',
  currency_code: 'SAR',
  timezone: 'Asia/Riyadh',
  fiscal_year_start_month: 1,
  default_locale: 'en',
  date_display: 'dual',
  working_days: [0, 1, 2, 3, 4],
  work_starts_at: '08:00:00',
  work_ends_at: '16:00:00',
};
const profile: OrganizationProfile = {
  nameAr: 'شركة الراية',
  nameEn: 'Al Raya Company',
  industry: 'banking_financial',
  countryCode: 'SA',
  currencyCode: 'SAR',
  timeZone: 'Asia/Riyadh',
  fiscalYearStartMonth: 1,
  defaultLocale: 'en',
  dateDisplay: 'dual',
  workingDays: [0, 1, 2, 3, 4],
  workStartsAt: '08:00',
  workEndsAt: '16:00',
};

describe('organization profile (T-M2-22)', () => {
  it("reads the organization's profile through RLS, with its last editor", async () => {
    const { tx, executed } = fakeTx([
      {
        ...row,
        updated_at: '2026-10-14T11:05:00Z',
        version: 3,
        editor_name_ar: 'منى',
        editor_name_en: 'Mona',
      },
    ]);
    expect(await getOrganizationProfile(tx)).toEqual({
      ...profile,
      updatedAt: new Date('2026-10-14T11:05:00Z'),
      updatedBy: { nameAr: 'منى', nameEn: 'Mona' },
      version: 3,
    });
    expect(executed[0]?.sql).toContain('private.current_tenant_id()');
    expect(executed[0]?.sql).toContain('platform.tenant_settings');
  });

  it('never saved: no editor; text arrays and unknown values read safely', async () => {
    const { tx } = fakeTx([
      {
        ...row,
        name_en: null,
        working_days: '{1,2}',
        date_display: 'julian',
        default_locale: 'ar',
        updated_at: new Date(0),
        version: '1',
        editor_name_ar: null,
        editor_name_en: null,
      },
    ]);
    expect(await getOrganizationProfile(tx)).toMatchObject({
      nameEn: null,
      workingDays: [1, 2],
      dateDisplay: 'gregorian',
      defaultLocale: 'ar',
      updatedBy: null,
      version: 1,
    });
    expect(
      (await getOrganizationProfile(fakeTx([{ ...row, working_days: null }]).tx))?.workingDays,
    ).toEqual([]);
    expect(await getOrganizationProfile(fakeTx([]).tx)).toBeNull();
  });

  it('saves the settings and, when they changed, the display names; returns before, after and the version', async () => {
    const renamed = {
      ...profile,
      nameEn: 'Al Raya Group',
      workingDays: [1, 2, 3, 4, 5],
      dateDisplay: 'hijri' as const,
    };
    const { tx, executed } = fakeTx(
      [{ ...row, version: 3 }],
      [{ tenant_id: 't' }],
      [{ id: 't' }],
      [
        {
          ...row,
          name_en: 'Al Raya Group',
          working_days: [1, 2, 3, 4, 5],
          date_display: 'hijri',
          version: 4,
        },
      ],
    );
    const saved = await updateOrganizationProfile(tx, renamed, 3);
    expect(saved).toEqual({ outcome: 'updated', before: profile, after: renamed, version: 4 });
    expect(executed[0]?.sql).toContain('for no key update of s, t');
    expect(executed[1]?.sql).toContain('update platform.tenant_settings');
    expect(executed[1]?.params).toEqual(
      expect.arrayContaining(['{1,2,3,4,5}', 'hijri', '08:00', '16:00', 3]),
    );
    expect(executed[2]?.sql).toContain('update platform.tenants set name_ar');
    expect(executed[2]?.params).toEqual(['شركة الراية', 'Al Raya Group']);
  });

  it('leaves the names alone when they did not change', async () => {
    const { tx, executed } = fakeTx(
      [{ ...row, version: 3 }],
      [{ tenant_id: 't' }],
      [{ ...row, currency_code: 'AED', version: 4 }],
    );
    expect(
      await updateOrganizationProfile(tx, { ...profile, currencyCode: 'AED' }, 3),
    ).toMatchObject({ outcome: 'updated', version: 4 });
    expect(executed.some((q) => q.sql.includes('update platform.tenants'))).toBe(false);
  });

  it('writes nothing when nothing changed (no new version)', async () => {
    const { tx, executed } = fakeTx([{ ...row, version: 3 }]);
    expect(await updateOrganizationProfile(tx, profile, 3)).toEqual({
      outcome: 'unchanged',
      version: 3,
    });
    expect(executed).toHaveLength(1);
  });

  it('accepts a country, currency or zone only when offered, or when it is the stored one', async () => {
    const offered = (field: string, value: string) =>
      !(field === 'timeZone' && value === 'Asia/Calcutta');
    expect(
      await updateOrganizationProfile(
        fakeTx([{ ...row, version: 3 }]).tx,
        { ...profile, timeZone: 'Asia/Calcutta' },
        3,
        offered,
      ),
    ).toEqual({ outcome: 'invalid', field: 'timeZone' });
    // The stored zone stays accepted even when no longer offered.
    const stored = fakeTx(
      [{ ...row, timezone: 'Asia/Calcutta', version: 3 }],
      [{ tenant_id: 't' }],
      [row],
    );
    expect(
      await updateOrganizationProfile(
        stored.tx,
        { ...profile, timeZone: 'Asia/Calcutta', currencyCode: 'AED' },
        3,
        offered,
      ),
    ).toMatchObject({ outcome: 'updated' });
  });

  it("a zone the database does not know is the field's error, not a fault; other errors are thrown", async () => {
    const failing = (error: Error) =>
      ({
        execute: (() => {
          let call = 0;
          return () => {
            call += 1;
            return call === 1 ? Promise.resolve([{ ...row, version: 3 }]) : Promise.reject(error);
          };
        })(),
      }) as unknown as UserTx;
    expect(
      await updateOrganizationProfile(
        failing(
          Object.assign(new Error('x'), {
            code: '23514',
            constraint_name: 'tenant_settings_timezone_check',
          }),
        ),
        { ...profile, timeZone: 'Asia/Dubai' },
        3,
      ),
    ).toEqual({ outcome: 'invalid', field: 'timeZone' });
    await expect(
      updateOrganizationProfile(
        failing(new Error('boom')),
        { ...profile, timeZone: 'Asia/Dubai' },
        3,
      ),
    ).rejects.toThrow('boom');
  });

  it('conflict on another version; refused when the database lets nothing change', async () => {
    const changed = { ...profile, currencyCode: 'AED' };
    expect(
      await updateOrganizationProfile(fakeTx([{ ...row, version: 4 }]).tx, changed, 3),
    ).toEqual({
      outcome: 'conflict',
    });
    expect(await updateOrganizationProfile(fakeTx([]).tx, changed, 3)).toEqual({
      outcome: 'refused',
    });
    expect(
      await updateOrganizationProfile(fakeTx([{ ...row, version: 3 }], []).tx, changed, 3),
    ).toEqual({
      outcome: 'refused',
    });
    const renamed = { ...profile, nameAr: 'اسم آخر' };
    expect(
      await updateOrganizationProfile(
        fakeTx([{ ...row, version: 3 }], [{ tenant_id: 't' }], []).tx,
        renamed,
        3,
      ),
    ).toEqual({ outcome: 'refused' });
    expect(
      await updateOrganizationProfile(
        fakeTx([{ ...row, version: 3 }], [{ tenant_id: 't' }], []).tx,
        changed,
        3,
      ),
    ).toEqual({ outcome: 'refused' });
  });

  it('lists the changed fields', () => {
    expect(changedProfileFields(profile, profile)).toEqual([]);
    expect(
      changedProfileFields(profile, { ...profile, workingDays: [0, 1, 2, 3], currencyCode: 'AED' }),
    ).toEqual(['currencyCode', 'workingDays']);
  });
});
