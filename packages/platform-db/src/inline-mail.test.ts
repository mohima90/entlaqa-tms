import { createHash } from 'node:crypto';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from './client';
import {
  createInlineMailApi,
  prepareInlineInvitation,
  queueInlineEmail,
} from './inline-mail';

const dialect = new PgDialect();
const ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
const INVITATION = '6a1f3c2e-4b5d-4e6f-8a7b-9c0d1e2f3a4b';
const SECRET = Buffer.alloc(32, 9);

/** Answers each `private.` call with `rows`; records the statements. */
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
  const db = { transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as AppDatabase;
  return { db, tx: tx as never, executed };
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

describe('the invitation e-mail\'s facts', () => {
  const prepared = {
    invitation_id: INVITATION,
    send_count: 2,
    email: 'noura@raya.example',
    locale: 'xx',
    person_id: 'p1',
    invite_code: 'K7M2PQ9XHT4W',
    recipient_ar: 'نورة',
    recipient_en: null,
    inviter_ar: null,
    inviter_en: null,
    organization_ar: 'شركة الراية',
    organization_en: 'Al Raya',
    primary_role: 'learner',
    role_name_ar: 'منسق',
    role_name_en: 'Coordinator',
    expires_at: '2026-10-14T06:00:00.000Z',
    source_key: `invitation:${INVITATION}:2`,
    action_color: '#112233',
    link_color: 'red',
    logo_asset_id: null,
  };

  it('are read through the one function that checks the member\'s authority; an unknown language is Arabic', async () => {
    const { tx, executed } = fakeDb([prepared]);
    const facts = await prepareInlineInvitation(tx, INVITATION);
    expect(executed[0]?.sql).toBe('select * from private.inline_invitation_prepare($1::uuid)');
    expect(facts).toMatchObject({
      invitationId: INVITATION,
      sendCount: 2,
      locale: 'ar',
      code: 'K7M2PQ9XHT4W',
      sourceKey: `invitation:${INVITATION}:2`,
      primaryRoleName: { ar: 'منسق', en: 'Coordinator' },
    });
    // No inviter name: the organization's name stands in. A bad colour is not used.
    expect(facts?.inviterName).toEqual({ ar: 'شركة الراية', en: 'Al Raya' });
    expect(facts?.brand).toBeNull();
    expect(facts?.expiresAt).toEqual(new Date('2026-10-14T06:00:00.000Z'));
  });

  it('no row: nothing to e-mail', async () => {
    const { tx } = fakeDb([]);
    expect(await prepareInlineInvitation(tx, INVITATION)).toBeNull();
  });
});

describe('queueing in the action\'s transaction', () => {
  const mail = {
    kind: 'invitation',
    ref: INVITATION,
    template: 'platform.invitation',
    templateVersion: 1,
    locale: 'en',
    to: 'noura@raya.example',
    subject: 'Invitation',
    html: '<p>x</p>',
    text: 'x',
    sourceKey: `invitation:${INVITATION}:1`,
  } as const;

  it('keeps only the secret\'s SHA-256 in the database and returns the secret to the caller', async () => {
    const { tx, executed } = fakeDb([{ id: ID }]);
    const ticket = await queueInlineEmail(tx, mail);
    expect(ticket?.id).toBe(ID);
    expect(ticket?.secret).toHaveLength(32);
    const params = executed[0]?.params ?? [];
    const hash = params.find((p) => Buffer.isBuffer(p) || p instanceof Uint8Array) as Uint8Array | undefined;
    expect(Buffer.from(hash ?? []).equals(createHash('sha256').update(ticket?.secret ?? Buffer.alloc(0)).digest())).toBe(true);
    // The secret itself is never sent to the database here.
    expect(JSON.stringify(params)).not.toContain(ticket?.secret.toString('hex') ?? 'x');
    expect(executed[0]?.sql).toContain('private.inline_mail_queue');
  });

  it('every ticket has its own secret', async () => {
    const { tx } = fakeDb([{ id: ID }]);
    const a = await queueInlineEmail(tx, mail);
    const b = await queueInlineEmail(tx, mail);
    expect(a?.secret.equals(b?.secret ?? Buffer.alloc(0))).toBe(false);
  });

  it('the same message queued already: no ticket', async () => {
    const { tx } = fakeDb([{ id: null }]);
    expect(await queueInlineEmail(tx, mail)).toBeNull();
    const none = fakeDb([]);
    expect(await queueInlineEmail(none.tx, mail)).toBeNull();
  });
});

describe('claiming and finishing', () => {
  const claimed = {
    outcome: 'claimed',
    tenant_id: 'a0000000-0000-4000-8000-000000000001',
    template: 'platform.invitation',
    destination: 'noura@raya.example',
    subject: 'Invitation',
    html: '<p>x</p>',
    text_body: 'x',
    attempts: 1,
    ...routeRow,
  };

  it('claims in a transaction without claims - the secret is the credential - and brings the sender settings', async () => {
    const { db, executed } = fakeDb([claimed]);
    const api = createInlineMailApi(() => db);
    const result = await api.claim(ID, SECRET);
    expect(result).toMatchObject({
      outcome: 'claimed',
      mail: {
        tenantId: claimed.tenant_id,
        destination: 'noura@raya.example',
        text: 'x',
        attempts: 1,
        route: { platform: { provider: 'resend', verified: true }, brandNameEn: 'Al Raya' },
      },
    });
    expect(executed[0]?.sql).toBe('set local role authenticated');
    expect(executed[1]?.params).toEqual(['']);
    expect(executed.at(-1)?.sql).toBe('select * from private.inline_mail_claim($1::uuid, $2::bytea)');
  });

  it('busy and gone are answers, not errors; anything incomplete is gone', async () => {
    for (const outcome of ['busy', 'gone'] as const) {
      const { db } = fakeDb([{ outcome }]);
      expect(await createInlineMailApi(() => db).claim(ID, SECRET)).toEqual({ outcome });
    }
    const empty = fakeDb([]);
    expect(await createInlineMailApi(() => empty.db).claim(ID, SECRET)).toEqual({ outcome: 'gone' });
    const incomplete = fakeDb([{ ...claimed, destination: null }]);
    expect(await createInlineMailApi(() => incomplete.db).claim(ID, SECRET)).toEqual({
      outcome: 'gone',
    });
  });

  it('a malformed id or secret never reaches the database', async () => {
    const { db, executed } = fakeDb([claimed]);
    const api = createInlineMailApi(() => db);
    expect(await api.claim('not-an-id', SECRET)).toEqual({ outcome: 'gone' });
    expect(await api.claim(ID, Buffer.alloc(5))).toEqual({ outcome: 'gone' });
    expect(await api.finish('x', SECRET, { status: 'retry', errorCode: 'X1' })).toBe(false);
    expect(executed).toHaveLength(0);
  });

  it('records each outcome', async () => {
    const { db, executed } = fakeDb([{ done: true }]);
    const api = createInlineMailApi(() => db);
    expect(
      await api.finish(ID, SECRET, {
        status: 'sent',
        provider: 'resend',
        providerMessageId: 'm1',
        sender: 'platform',
      }),
    ).toBe(true);
    expect(executed.at(-1)?.params).toEqual([ID, SECRET, 'sent', null, 'resend', 'm1', 'platform']);
    await api.finish(ID, SECRET, {
      status: 'failed',
      errorCode: 'INVALID_ADDRESS',
      provider: 'resend',
      sender: null,
    });
    expect(executed.at(-1)?.params).toEqual([ID, SECRET, 'failed', 'INVALID_ADDRESS', 'resend', null, null]);
    await api.finish(ID, SECRET, { status: 'retry', errorCode: 'NO_SENDER' });
    expect(executed.at(-1)?.params).toEqual([ID, SECRET, 'retry', 'NO_SENDER', null, null, null]);
    const lost = fakeDb([{ done: false }]);
    expect(
      await createInlineMailApi(() => lost.db).finish(ID, SECRET, { status: 'retry', errorCode: 'X1' }),
    ).toBe(false);
  });
});
