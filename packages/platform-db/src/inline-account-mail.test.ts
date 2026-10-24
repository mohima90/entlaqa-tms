import { createHash } from 'node:crypto';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { createAccountMailApi } from './account-mail';
import type { AppDatabase } from './client';
import {
  createInlineAccountMailApi,
  createInlineRecoveryApi,
  tagInlineAccountMail,
} from './inline-account-mail';

const dialect = new PgDialect();
const USER = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
const TENANT = 'a0000000-0000-4000-8000-000000000001';
const PERSON = 'a1000000-0000-4000-8000-0000000000a1';
const REQUEST = '6a1f3c2e-4b5d-4e6f-8a7b-9c0d1e2f3a4b';
const SECRET = Buffer.alloc(32, 9);

/** Answers each `private.` call with the rows given for the function it names; records the statements. */
function fakeDb(rows: Record<string, Record<string, unknown>[]> = {}, failOn?: string) {
  const executed: { sql: string; params: unknown[] }[] = [];
  interface FakeTx {
    execute(query: SQL): Promise<unknown[]>;
    transaction(fn: (savepoint: FakeTx) => Promise<unknown>): Promise<unknown>;
  }
  const tx: FakeTx = {
    execute: (query) => {
      const q = dialect.sqlToQuery(query);
      executed.push(q);
      if (failOn && q.sql.includes(failOn)) return Promise.reject(new Error('boom'));
      const hit = Object.keys(rows).find((name) => q.sql.includes(name));
      return Promise.resolve(hit ? (rows[hit] ?? []) : []);
    },
    transaction: (fn) => fn(tx),
  };
  const db = {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as AppDatabase;
  return { db, tx: tx as never, executed };
}

const sendRow = {
  outcome: 'send',
  request_id: REQUEST,
  kind: 'password_changed',
  user_id: USER,
  tenant_id: TENANT,
  person_id: PERSON,
  email: 'noura@raya.example',
  locale: 'en',
  attempts: 1,
  factor_id: null,
  mfa_reason: null,
  detail: null,
  lock_minutes: null,
  organization_ar: 'شركة الراية',
  organization_en: 'Al Raya',
  recipient_ar: 'نورة',
  recipient_en: 'Noura',
  recent_count: '2',
  quiet_count: 0,
  tenant_recent_count: '7',
  platform_sender: false,
  changed_by_ar: null,
  changed_by_en: null,
  set_up_at: null,
  setup_user_agent: null,
  action_color: '#112233',
  link_color: 'red',
  logo_asset_id: null,
};

describe('tagging what the transaction queued', () => {
  it('keeps only the SHA-256 of the secret in the database and returns the secret when something was tagged', async () => {
    const { tx, executed } = fakeDb({ inline_account_mail_tag: [{ tagged: 2 }] });
    const ticket = await tagInlineAccountMail(tx);
    expect(ticket?.secret).toHaveLength(32);
    const hash = executed[0]?.params[0] as Uint8Array;
    expect(
      Buffer.from(hash).equals(
        createHash('sha256')
          .update(ticket?.secret ?? '')
          .digest(),
      ),
    ).toBe(true);
    expect(JSON.stringify(executed[0]?.params)).not.toContain(
      ticket?.secret.toString('hex') ?? 'x',
    );
  });

  it('nothing tagged: no ticket (nothing to send from here)', async () => {
    const { tx } = fakeDb({ inline_account_mail_tag: [{ tagged: 0 }] });
    expect(await tagInlineAccountMail(tx)).toBeNull();
    const none = fakeDb();
    expect(await tagInlineAccountMail(none.tx)).toBeNull();
  });

  it('the request functions tag in the same transaction only when asked, and never lose the request when tagging fails', async () => {
    const asked = fakeDb({ inline_account_mail_tag: [{ tagged: 1 }] });
    const api = createAccountMailApi(() => asked.db);
    const ticket = await api.requestAccountLockedMail('a@example.test', 15, { inline: true });
    expect(ticket?.secret).toHaveLength(32);
    const calls = asked.executed.map((q) => q.sql);
    expect(calls.findIndex((q) => q.includes('request_account_locked_mail'))).toBeLessThan(
      calls.findIndex((q) => q.includes('inline_account_mail_tag')),
    );
    // The same call also for the other two anonymous kinds.
    expect(await api.requestPasswordChangedMail(USER, { inline: true })).not.toBeNull();
    expect(await api.requestMfaCodeLockedMail(USER, 15, { inline: true })).not.toBeNull();

    const notAsked = fakeDb({ inline_account_mail_tag: [{ tagged: 1 }] });
    expect(
      await createAccountMailApi(() => notAsked.db).requestAccountLockedMail('a@example.test', 15),
    ).toBeNull();
    expect(notAsked.executed.some((q) => q.sql.includes('inline_account_mail_tag'))).toBe(false);

    // The database does not know the function yet (the app deployed first): the request stays, untagged.
    const old = fakeDb({}, 'inline_account_mail_tag');
    expect(
      await createAccountMailApi(() => old.db).requestPasswordChangedMail(USER, { inline: true }),
    ).toBeNull();
    expect(old.executed.some((q) => q.sql.includes('request_password_changed_mail'))).toBe(true);
  });
});

describe('claiming, queueing and removing a request', () => {
  it('claims in a transaction without claims - the secret is the credential - and maps the row', async () => {
    const { db, executed } = fakeDb({ inline_account_mail_claim: [sendRow] });
    const claim = await createInlineAccountMailApi(() => db).claim(SECRET, 1440);
    expect(executed[0]?.sql).toBe('set local role authenticated');
    expect(executed[1]?.params).toEqual(['']);
    expect(executed.at(-1)?.sql).toBe(
      'select * from private.inline_account_mail_claim($1::bytea, $2::integer)',
    );
    expect(claim).toMatchObject({
      outcome: 'send',
      requestId: REQUEST,
      kind: 'password_changed',
      email: 'noura@raya.example',
      locale: 'en',
      recentCount: 2,
      tenantRecentCount: 7,
      platformSender: false,
      organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
    });
    // A bad colour is not used.
    expect((claim as { brand: unknown }).brand).toBeNull();
  });

  it('anything but a clear "no" is the platform sender; the set-up facts and the policy editor come with the claim', async () => {
    const { db } = fakeDb({
      inline_account_mail_claim: [
        {
          ...sendRow,
          kind: 'mfa_factor_added',
          factor_id: 'f3000000-0000-4000-8000-0000000000a1',
          platform_sender: null,
          set_up_at: '2026-10-23T10:00:00.000Z',
          setup_user_agent: 'Mozilla/5.0 test',
          changed_by_ar: 'مدير',
          changed_by_en: null,
          action_color: '#112233',
          link_color: '#445566',
          lock_minutes: 15,
        },
      ],
    });
    const claim = await createInlineAccountMailApi(() => db).claim(SECRET, 60);
    expect(claim).toMatchObject({
      outcome: 'send',
      platformSender: true,
      setUpAt: new Date('2026-10-23T10:00:00.000Z'),
      setupUserAgent: 'Mozilla/5.0 test',
      changedByName: { ar: 'مدير', en: null },
      lockMinutes: 15,
      brand: { actionColor: '#112233', linkColor: '#445566', logoAssetId: null },
    });
  });

  it('answers without an e-mail: nothing waits, or why a request is not sent (the database removed it)', async () => {
    const none = fakeDb({ inline_account_mail_claim: [{ outcome: 'none' }] });
    expect(await createInlineAccountMailApi(() => none.db).claim(SECRET, 60)).toEqual({
      outcome: 'none',
    });
    const empty = fakeDb();
    expect(await createInlineAccountMailApi(() => empty.db).claim(SECRET, 60)).toEqual({
      outcome: 'none',
    });
    for (const outcome of ['banned', 'held', 'no_membership', 'unknown_account', 'factor_gone']) {
      const skip = fakeDb({
        inline_account_mail_claim: [{ outcome, request_id: REQUEST, kind: 'mfa_code_locked' }],
      });
      expect(await createInlineAccountMailApi(() => skip.db).claim(SECRET, 60)).toEqual({
        outcome,
        requestId: REQUEST,
        kind: 'mfa_code_locked',
      });
    }
  });

  it('an incomplete claim is an error, never a half-addressed e-mail', async () => {
    const { db } = fakeDb({ inline_account_mail_claim: [{ ...sendRow, email: null }] });
    await expect(createInlineAccountMailApi(() => db).claim(SECRET, 60)).rejects.toThrow(
      'incomplete claim',
    );
  });

  it('a malformed secret, id or quiet period never reaches the database', async () => {
    const { db, executed } = fakeDb({ inline_account_mail_claim: [sendRow] });
    const api = createInlineAccountMailApi(() => db);
    expect(await api.claim(Buffer.alloc(5), 60)).toEqual({ outcome: 'none' });
    expect(await api.claim(SECRET, -1)).toEqual({ outcome: 'none' });
    expect(await api.claim(SECRET, 1441)).toEqual({ outcome: 'none' });
    expect(
      await api.queue(SECRET, 'nope', {
        template: 't',
        templateVersion: 1,
        locale: 'en',
        subject: 's',
        html: 'h',
        text: 't',
      }),
    ).toBeNull();
    expect(await api.done(Buffer.alloc(5), REQUEST)).toBe(false);
    expect(await api.done(SECRET, 'nope')).toBe(false);
    expect(executed).toHaveLength(0);
  });

  it('queues with the set-up hashes only when given, and removes a claimed request', async () => {
    const { db, executed } = fakeDb({
      inline_account_mail_queue: [{ id: 'd1' }],
      inline_account_mail_done: [{ done: true }],
    });
    const api = createInlineAccountMailApi(() => db);
    const mail = {
      template: 'platform.mfa_factor_added',
      templateVersion: 1,
      locale: 'en' as const,
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    };
    expect(await api.queue(SECRET, REQUEST, mail)).toBe('d1');
    expect(executed.at(-1)?.params.slice(-2)).toEqual([null, null]);
    const codeHash = Buffer.alloc(32, 1);
    const removeHash = Buffer.alloc(32, 2);
    await api.queue(SECRET, REQUEST, { ...mail, codeHash, removeHash });
    expect(executed.at(-1)?.params.slice(-2)).toEqual([codeHash, removeHash]);
    expect(await api.done(SECRET, REQUEST)).toBe(true);
    const gone = fakeDb({ inline_account_mail_queue: [{ id: null }] });
    expect(await createInlineAccountMailApi(() => gone.db).queue(SECRET, REQUEST, mail)).toBeNull();
  });
});

describe('the reset e-mail of the Send Email hook', () => {
  const facts = {
    email: 'noura@raya.example',
    tenant_id: TENANT,
    person_id: PERSON,
    locale: 'xx',
    platform_sender: true,
    has_app: true,
    organization_ar: 'شركة الراية',
    organization_en: 'Al Raya',
    action_color: '#112233',
    link_color: '#445566',
    logo_asset_id: null,
  };

  it('reads the facts of the account Auth is e-mailing; an unknown language is Arabic; nothing for an unusable account', async () => {
    const { db, executed } = fakeDb({ inline_recovery_facts: [facts] });
    const api = createInlineRecoveryApi(() => db);
    expect(await api.facts(USER)).toMatchObject({
      email: 'noura@raya.example',
      locale: 'ar',
      platformSender: true,
      hasApp: true,
      organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
      brand: { actionColor: '#112233', linkColor: '#445566', logoAssetId: null },
    });
    expect(executed[1]?.params).toEqual(['']);
    const none = fakeDb();
    expect(await createInlineRecoveryApi(() => none.db).facts(USER)).toBeNull();
    expect(await createInlineRecoveryApi(() => none.db).facts('nope')).toBeNull();
  });

  it('queues with the SHA-256 of a fresh secret and hands the secret back; null when over the cap or queued already', async () => {
    const { db, executed } = fakeDb({ inline_recovery_queue: [{ id: 'd9' }] });
    const mail = {
      userId: USER,
      template: 'platform.password_reset',
      templateVersion: 1,
      locale: 'en' as const,
      to: 'noura@raya.example',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
      sourceKey: 'recovery:0123456789abcdef0123456789abcdef',
    };
    const ticket = await createInlineRecoveryApi(() => db).queue(mail);
    expect(ticket?.id).toBe('d9');
    expect(ticket?.secret).toHaveLength(32);
    const params = executed.at(-1)?.params ?? [];
    expect(
      Buffer.from(params.at(-1) as Uint8Array).equals(
        createHash('sha256')
          .update(ticket?.secret ?? '')
          .digest(),
      ),
    ).toBe(true);
    expect(JSON.stringify(params)).not.toContain(ticket?.secret.toString('hex') ?? 'x');
    const capped = fakeDb({ inline_recovery_queue: [{ id: null }] });
    expect(await createInlineRecoveryApi(() => capped.db).queue(mail)).toBeNull();
    expect(await createInlineRecoveryApi(() => db).queue({ ...mail, userId: 'nope' })).toBeNull();
  });
});
