import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { getCurrentTenant } from './tenants';

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
    const fake = tx([{ id: 't1', name_ar: 'المنشأة', name_en: 'Org' }]);
    expect(await getCurrentTenant(fake.tx)).toEqual({
      tenantId: 't1',
      nameAr: 'المنشأة',
      nameEn: 'Org',
    });
    expect(fake.executed[0]).toContain('private.current_tenant_id()');
  });

  it('returns null when the claims resolve to no tenant', async () => {
    expect(await getCurrentTenant(tx([]).tx)).toBeNull();
  });
});
