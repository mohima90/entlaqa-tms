import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from './client';
import {
  createWithUserTx,
  databaseClaims,
  listSessionTenants,
  switchActiveTenant,
} from './with-user-tx';

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
      {
        sql: "select set_config('request.jwt.claims', $1, true)",
        params: [
          JSON.stringify({
            sub: c.sub,
            role: 'authenticated',
            session_id: c.session_id,
            tenant_id: c.tenant_id,
            aal: 'aal1',
          }),
        ],
      },
      {
        sql: "select set_config('request.jwt.claim', '', true), set_config('request.jwt.claim.sub', '', true), private.touch_session()",
        params: [],
      },
    ]);
  });

  it('records activity only for a session acting in an organization (T-M2-10 inactivity rule)', async () => {
    const { db, executed } = fakeDatabase();
    const withUserTx = createWithUserTx(() => db);
    const preTenant = brandVerifiedClaims({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'authenticated',
      aal: 'aal1',
      session_id: '33333333-3333-4333-8333-333333333333',
    });
    if (!preTenant.ok) throw new Error('fixture claims invalid');
    await withUserTx(preTenant.value, () => Promise.resolve(null));
    expect(executed[2]?.sql).not.toContain('touch_session');
    await withUserTx(claims(), () => Promise.resolve(null));
    expect(executed[5]?.sql).toContain('private.touch_session()');
  });

  it('never interpolates claim values into SQL text (injection-safe)', async () => {
    const { db, executed } = fakeDatabase();
    const withUserTx = createWithUserTx(() => db);
    await withUserTx(claims({ email: "x'); drop table platform.tenants; --" }), () =>
      Promise.resolve(null),
    );
    expect(executed.map((q) => q.sql).join('\n')).not.toContain('drop table');
    expect(executed[1]?.sql).toBe("select set_config('request.jwt.claims', $1, true)");
  });

  it('forwards only the allow-listed claims: no e-mail, metadata or invitation token (re-review N5)', async () => {
    const { db, executed } = fakeDatabase();
    const withUserTx = createWithUserTx(() => db);
    const c = claims({
      person_id: '44444444-4444-4444-8444-444444444444',
      email: 'invitee@example.test',
      phone: '966500000000',
      user_metadata: { invitation: 'raw-invitation-token-raw-invitation-token-x' },
      app_metadata: { provider: 'email' },
      amr: [{ method: 'password', timestamp: 1 }],
      exp: 1_900_000_000,
      iat: 1_800_000_000,
      iss: 'https://auth.example.test/auth/v1',
      aud: 'authenticated',
      actor: '55555555-5555-4555-8555-555555555555',
      is_anonymous: false,
    });
    await withUserTx(c, () => Promise.resolve(null));
    const forwarded = JSON.parse(String(executed[1]?.params[0])) as Record<string, unknown>;
    expect(Object.keys(forwarded).sort()).toEqual([
      'aal',
      'person_id',
      'role',
      'session_id',
      'sub',
      'tenant_id',
    ]);
    expect(String(executed[1]?.params[0])).not.toMatch(/invitee@|invitation|966500000000/);
  });

  it('adds code_at — when the session last passed an authenticator code — never the amr itself', async () => {
    const { db, executed } = fakeDatabase();
    const withUserTx = createWithUserTx(() => db);
    await withUserTx(
      claims({
        aal: 'aal2',
        amr: [
          { method: 'password', timestamp: 1_800_000_000 },
          { method: 'totp', timestamp: 1_800_000_100 },
          { method: 'totp', timestamp: 1_800_000_050 },
        ],
      }),
      () => Promise.resolve(null),
    );
    const forwarded = JSON.parse(String(executed[1]?.params[0])) as Record<string, unknown>;
    expect(forwarded.code_at).toBe('1800000100');
    expect(forwarded.aal).toBe('aal2');
    expect(forwarded).not.toHaveProperty('amr');
    // Without a code: no code_at (the database then refuses high-risk changes).
    expect(
      databaseClaims({ sub: claims().sub, role: 'authenticated', amr: [] }),
    ).not.toHaveProperty('code_at');
    expect(
      databaseClaims({
        sub: claims().sub,
        role: 'authenticated',
        amr: [{ method: 'totp', timestamp: 'soon' }],
      }),
    ).not.toHaveProperty('code_at');
  });

  it('databaseClaims leaves out absent claims and non-string values', () => {
    expect(
      databaseClaims({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        tenant_id: undefined,
      }),
    ).toEqual({ sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated' });
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
