import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from './client';
import { createWithUserTx, listSessionTenants, switchActiveTenant } from './with-user-tx';

const dialect = new PgDialect();
const toQuery = (query: SQL) => {
  const { sql, params } = dialect.sqlToQuery(query);
  return { sql, params };
};

function fakeDatabase() {
  const executed: { sql: string; params: unknown[] }[] = [];
  let transactions = 0;
  const tx = {
    execute: (query: SQL) => {
      executed.push(toQuery(query));
      return Promise.resolve([]);
    },
  };
  const db = {
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => {
      transactions += 1;
      return cb(tx);
    },
  } as unknown as AppDatabase;
  return { db, executed, transactionCount: () => transactions };
}

function claims(extra: Record<string, unknown> = {}) {
  const result = brandVerifiedClaims({
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'authenticated',
    aal: 'aal1',
    session_id: '33333333-3333-4333-8333-333333333333',
    tenant_id: '22222222-2222-4222-8222-222222222222',
    ...extra,
  });
  if (!result.ok) throw new Error('fixture claims invalid');
  return result.value;
}

describe('withUserTx (ADR 0002 §5)', () => {
  it('opens a transaction, sets role authenticated, then sets request.jwt.claims as a bound parameter', async () => {
    const { db, executed, transactionCount } = fakeDatabase();
    const withUserTx = createWithUserTx(() => db);
    const c = claims();

    const result = await withUserTx(c, () => Promise.resolve('done'));

    expect(result).toBe('done');
    expect(transactionCount()).toBe(1);
    expect(executed).toEqual([
      { sql: 'set local role authenticated', params: [] },
      { sql: "select set_config('request.jwt.claims', $1, true)", params: [JSON.stringify(c)] },
      {
        sql: "select set_config('request.jwt.claim', '', true), set_config('request.jwt.claim.sub', '', true)",
        params: [],
      },
    ]);
  });

  it('never interpolates claim values into SQL text (injection-safe)', async () => {
    const { db, executed } = fakeDatabase();
    const withUserTx = createWithUserTx(() => db);
    await withUserTx(claims({ email: "x'); drop table platform.tenants; --" }), () =>
      Promise.resolve(null),
    );
    expect(executed[1]?.sql).toBe("select set_config('request.jwt.claims', $1, true)");
    expect(executed[1]?.params[0]).toContain('drop table');
  });

  it('runs the unit of work after the session settings and propagates its errors (rollback)', async () => {
    const { db, executed } = fakeDatabase();
    const withUserTx = createWithUserTx(() => db);
    await expect(
      withUserTx(claims(), () => {
        expect(executed).toHaveLength(3);
        return Promise.reject(new Error('handler failed'));
      }),
    ).rejects.toThrow('handler failed');
  });

  it('refuses claim sets that do not match the verified-claims schema', async () => {
    const { db, transactionCount } = fakeDatabase();
    const withUserTx = createWithUserTx(() => db);
    const forged = JSON.parse('{"role":"service_role"}') as never;
    await expect(withUserTx(forged, () => Promise.resolve(1))).rejects.toThrow(/refusing claims/);
    expect(transactionCount()).toBe(0);
  });

  it('refuses non-user roles and claims without an Auth session id', async () => {
    const { db, transactionCount } = fakeDatabase();
    const withUserTx = createWithUserTx(() => db);
    await expect(
      withUserTx(claims({ role: 'service_role' }), () => Promise.resolve(1)),
    ).rejects.toThrow(/refusing claims/);
    await expect(
      withUserTx(claims({ session_id: undefined }), () => Promise.resolve(1)),
    ).rejects.toThrow(/refusing claims/);
    expect(transactionCount()).toBe(0);
  });
});

describe('switchActiveTenant', () => {
  it('calls private.switch_active_tenant with a bound parameter and reports the result', async () => {
    const executed: { sql: string; params: unknown[] }[] = [];
    const tx = {
      execute: (query: SQL) => {
        executed.push(toQuery(query));
        return Promise.resolve([{ switched: executed.length === 1 }]);
      },
    } as unknown as Parameters<typeof switchActiveTenant>[0];
    expect(await switchActiveTenant(tx, '22222222-2222-4222-8222-222222222222')).toBe(true);
    expect(await switchActiveTenant(tx, '22222222-2222-4222-8222-222222222222')).toBe(false);
    expect(executed[0]).toEqual({
      sql: 'select private.switch_active_tenant($1::uuid) as switched',
      params: ['22222222-2222-4222-8222-222222222222'],
    });
  });
});

describe('listSessionTenants', () => {
  it('reads private.session_tenants() and maps the rows', async () => {
    const executed: { sql: string; params: unknown[] }[] = [];
    const tx = {
      execute: (query: SQL) => {
        executed.push(toQuery(query));
        return Promise.resolve([
          {
            tenant_id: 'a0000000-0000-4000-8000-000000000001',
            name_ar: 'المنشأة أ',
            name_en: 'Tenant A',
          },
          {
            tenant_id: 'b0000000-0000-4000-8000-000000000001',
            name_ar: 'المنشأة ب',
            name_en: null,
          },
        ]);
      },
    };
    const tenants = await listSessionTenants(tx as never);
    expect(executed).toEqual([
      { sql: 'select tenant_id, name_ar, name_en from private.session_tenants()', params: [] },
    ]);
    expect(tenants).toEqual([
      { tenantId: 'a0000000-0000-4000-8000-000000000001', nameAr: 'المنشأة أ', nameEn: 'Tenant A' },
      { tenantId: 'b0000000-0000-4000-8000-000000000001', nameAr: 'المنشأة ب', nameEn: null },
    ]);
  });
});
