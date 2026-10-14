import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_REGIONAL, getCurrentTenant } from './tenants';

const dialect = new PgDialect();

function tx(rows: unknown[]) {
  const executed: string[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        executed.push(dialect.sqlToQuery(query).sql);
        return Promise.resolve(rows);
      },
    } as never,
  };
}

describe('getCurrentTenant', () => {
  it('reads the current tenant through RLS', async () => {
    const fake = tx([
      {
        id: 't1',
        name_ar: 'المنشأة',
        name_en: 'Org',
        session_idle_minutes: 30,
        date_display: 'dual',
        timezone: 'Asia/Dubai',
        default_locale: 'en',
      },
    ]);
    expect(await getCurrentTenant(fake.tx)).toEqual({
      tenantId: 't1',
      nameAr: 'المنشأة',
      nameEn: 'Org',
      sessionIdleMinutes: 30,
      regional: { dateDisplay: 'dual', timeZone: 'Asia/Dubai', defaultLocale: 'en' },
    });
    expect(fake.executed[0]).toContain('private.current_tenant_id()');
    expect(fake.executed[0]).toContain('platform.tenant_settings');
  });

  it('has no inactivity limit without a policy row, and the defaults without settings', async () => {
    const fake = tx([{ id: 't1', name_ar: 'المنشأة', name_en: null, session_idle_minutes: null }]);
    const tenant = await getCurrentTenant(fake.tx);
    expect(tenant?.sessionIdleMinutes).toBeNull();
    expect(tenant?.regional).toEqual(DEFAULT_TENANT_REGIONAL);
  });

  it('returns null when the claims resolve to no tenant', async () => {
    expect(await getCurrentTenant(tx([]).tx)).toBeNull();
  });
});
