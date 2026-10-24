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

const accountRow = {
  email: 'sara@example.test',
  tenant_id: TENANT,
  person_id: USER,
  locale: 'en',
  platform_sender: false,
};
const issueInput = {
  userId: USER,
  code: '482913',
  sealedTokenHash: 'v1.sealed-token-hash-value',
  actionType: 'magiclink',
} as const;

describe('what the Send Email hook reads and writes (WP-ADM-05)', () => {
  it('stores the code and learns whom to e-mail in ONE call, in a transaction without claims', async () => {
    const { db, executed } = fakeDb([{ ...accountRow, ...routeRow }]);
    const api = createAuthMailApi(() => db);
    const issued = await api.issue(issueInput);
    expect(issued?.account).toEqual({
      email: 'sara@example.test',
      tenantId: TENANT,
      personId: USER,
      locale: 'en',
      platformSender: false,
    });
    expect(executed[0]?.sql).toBe('set local role authenticated');
    expect(executed[1]?.params).toEqual(['']);
    expect(executed.at(-1)?.sql).toBe(
      'select * from private.auth_mail_issue($1::uuid, $2, $3, $4)',
    );
    expect(executed.at(-1)?.params).toEqual([
      USER,
      '482913',
      'v1.sealed-token-hash-value',
      'magiclink',
    ]);
    // The sender settings come only with it: nothing reads them on their own.
    expect(executed.some((q) => q.sql.includes('auth_mail_route'))).toBe(false);
  });

  it('anything but a clear "no" to the platform-sender question means yes; an unknown language is Arabic', async () => {
    const api = createAuthMailApi(
      () => fakeDb([{ ...accountRow, ...routeRow, locale: 'xx', platform_sender: null }]).db,
    );
    await expect(api.issue(issueInput)).resolves.toMatchObject({
      account: { platformSender: true, locale: 'ar' },
    });
  });

  it('no row: nothing stored; a malformed id never reaches the database', async () => {
    const { db, executed } = fakeDb([]);
    const api = createAuthMailApi(() => db);
    await expect(api.issue(issueInput)).resolves.toBeNull();
    const before = executed.length;
    await expect(api.issue({ ...issueInput, userId: 'not-an-id' })).resolves.toBeNull();
    await api.auditSent('x', TENANT);
    expect(executed.length).toBe(before);
  });

  it('returns the sender settings of the organization and its look', async () => {
    const api = createAuthMailApi(() => fakeDb([{ ...accountRow, ...routeRow }]).db);
    const found = (await api.issue(issueInput))?.route;
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
    const bad = createAuthMailApi(
      () => fakeDb([{ ...accountRow, ...routeRow, action_color: 'red' }]).db,
    );
    expect((await bad.issue(issueInput))?.route.brand).toBeNull();
    const plain = createAuthMailApi(
      () => fakeDb([{ ...accountRow, ...routeRow, action_color: null, link_color: null }]).db,
    );
    expect((await plain.issue(issueInput))?.route.brand).toBeNull();
  });

  it('checks a typed code in the database: a right one releases the sealed token hash and its type', async () => {
    const { db, executed } = fakeDb([
      {
        outcome: 'ok',
        user_id: USER,
        token_hash_sealed: 'v1.sealed-token-hash-value',
        action_type: 'magiclink',
      },
    ]);
    const api = createAuthMailApi(() => db);
    await expect(api.verifyCode('sara@example.test', '482913')).resolves.toEqual({
      outcome: 'ok',
      userId: USER,
      sealedTokenHash: 'v1.sealed-token-hash-value',
      actionType: 'magiclink',
    });
    expect(executed.at(-1)?.sql).toBe('select * from private.verify_sign_in_code($1, $2)');
    expect(executed.at(-1)?.params).toEqual(['sara@example.test', '482913']);
  });

  it('a wrong code, the killing 5th, or no live code release nothing; anything unexpected is a refusal', async () => {
    for (const outcome of ['wrong', 'killed', 'none'] as const) {
      const api = createAuthMailApi(
        () => fakeDb([{ outcome, user_id: USER, token_hash_sealed: null, action_type: null }]).db,
      );
      await expect(api.verifyCode('sara@example.test', '000000')).resolves.toEqual({ outcome });
    }
    for (const rows of [
      [],
      [{ outcome: 'ok', user_id: USER, token_hash_sealed: null, action_type: 'magiclink' }],
      [{ outcome: 'ok', user_id: USER, token_hash_sealed: 'v1.x', action_type: 'recovery' }],
      [{ outcome: 'surprise', user_id: USER, token_hash_sealed: 'v1.x', action_type: 'magiclink' }],
    ]) {
      const api = createAuthMailApi(() => fakeDb(rows).db);
      await expect(api.verifyCode('sara@example.test', '000000')).resolves.toEqual({
        outcome: 'none',
      });
    }
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
