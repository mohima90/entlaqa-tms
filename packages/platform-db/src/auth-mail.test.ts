import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { createAuthMailApi } from './auth-mail';
import type { AppDatabase } from './client';

const dialect = new PgDialect();
const USER = '9d406f51-7e80-4192-9dae-2f3a4b5c6d7e';
const TENANT = '7b2e4d3f-5c6e-4f70-9b8c-0d1e2f3a4b5c';

/** A database whose transactions record the statements and answer the definer functions with `rows`. */
function fakeDb(rows: Record<string, unknown>[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  interface FakeTx {
    execute(query: SQL): Promise<unknown[]>;
    transaction(fn: (savepoint: FakeTx) => Promise<unknown>): Promise<unknown>;
  }
  const tx: FakeTx = {
    execute: (query) => {
      const q = dialect.sqlToQuery(query);
      executed.push(q);
      return Promise.resolve(q.sql.includes('private.') ? rows : []);
    },
    transaction: (fn) => fn(tx),
  };
  const db = {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as AppDatabase;
  return { db, executed };
}

const routeRow = {
  tenant_provider: null,
  tenant_options: null,
  tenant_credentials_sealed: null,
  tenant_from_name: null,
  tenant_from_address: null,
  tenant_reply_to: null,
  tenant_enabled: false,
  tenant_version: null,
  platform_configured: true,
  platform_provider: 'resend',
  platform_options: {},
  platform_credentials_sealed: 'sealed',
  platform_from_address: 'no-reply@jadarat.example',
  platform_verified: true,
  platform_version: 2,
  brand_name_ar: 'الراية',
  brand_name_en: 'Al Raya',
  default_locale: 'en',
  action_color: '#112233',
  link_color: '#445566',
  logo_asset_id: null,
};

describe('what the Send Email hook reads and writes (WP-ADM-05)', () => {
  it('asks who the e-mail goes to, in a transaction without claims', async () => {
    const { db, executed } = fakeDb([
      {
        email: 'sara@example.test',
        tenant_id: TENANT,
        person_id: USER,
        locale: 'en',
        platform_sender: false,
      },
    ]);
    const api = createAuthMailApi(() => db);
    await expect(api.account(USER)).resolves.toEqual({
      email: 'sara@example.test',
      tenantId: TENANT,
      personId: USER,
      locale: 'en',
      platformSender: false,
    });
    expect(executed[0]?.sql).toBe('set local role authenticated');
    expect(executed[1]?.params).toEqual(['']);
    expect(executed.at(-1)?.params).toEqual([USER]);
  });

  it('anything but a clear "no" to the platform-sender question means yes; an unknown language is Arabic', async () => {
    const api = createAuthMailApi(
      () =>
        fakeDb([
          {
            email: 'a@b.test',
            tenant_id: TENANT,
            person_id: USER,
            locale: 'xx',
            platform_sender: null,
          },
        ]).db,
    );
    await expect(api.account(USER)).resolves.toMatchObject({ platformSender: true, locale: 'ar' });
  });

  it('no row: no account; a malformed id never reaches the database', async () => {
    const { db, executed } = fakeDb([]);
    const api = createAuthMailApi(() => db);
    await expect(api.account(USER)).resolves.toBeNull();
    await expect(api.route(TENANT)).resolves.toBeNull();
    const before = executed.length;
    await expect(api.account('not-an-id')).resolves.toBeNull();
    await expect(api.route('not-an-id')).resolves.toBeNull();
    await api.auditSent('x', TENANT);
    expect(executed.length).toBe(before);
  });

  it('reads the sender settings of the organization and its look', async () => {
    const api = createAuthMailApi(() => fakeDb([routeRow]).db);
    const found = await api.route(TENANT);
    expect(found?.route).toMatchObject({
      tenant: null,
      platform: { provider: 'resend', verified: true, credentialsSealed: 'sealed' },
      brandNameEn: 'Al Raya',
      defaultLocale: 'en',
    });
    expect(found?.brand).toEqual({
      actionColor: '#112233',
      linkColor: '#445566',
      logoAssetId: null,
    });
    // Colours are checked again; a bad value is not used.
    const bad = createAuthMailApi(() => fakeDb([{ ...routeRow, action_color: 'red' }]).db);
    expect((await bad.route(TENANT))?.brand).toBeNull();
    const plain = createAuthMailApi(
      () => fakeDb([{ ...routeRow, action_color: null, link_color: null }]).db,
    );
    expect((await plain.route(TENANT))?.brand).toBeNull();
  });

  it('audits a sent code and a refused one by function, without a code or an address in the first', async () => {
    const { db, executed } = fakeDb([]);
    const api = createAuthMailApi(() => db);
    await api.auditSent(USER, TENANT);
    expect(executed.at(-1)?.sql).toBe('select private.audit_sign_in_code_sent($1::uuid, $2::uuid)');
    expect(executed.at(-1)?.params).toEqual([USER, TENANT]);
    await api.auditRefused('sara@example.test', true);
    expect(executed.at(-1)?.sql).toBe('select private.audit_sign_in_code_refused($1, $2)');
    expect(executed.at(-1)?.params).toEqual(['sara@example.test', true]);
  });
});
