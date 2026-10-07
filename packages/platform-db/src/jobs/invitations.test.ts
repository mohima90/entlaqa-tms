import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  invitationActorMayManage,
  issueInvitationToken,
  loadInvitationForMail,
} from './invitations';

const dialect = new PgDialect();
const ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
const HASH = Buffer.alloc(32, 7);

function fakeTx(...results: unknown[][]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        executed.push(dialect.sqlToQuery(query));
        return Promise.resolve(results.shift() ?? []);
      },
    } as never,
  };
}

const row = {
  id: ID,
  status: 'pending',
  send_count: 1,
  email: 'sara@example.com',
  locale: 'en',
  person_id: 'p1',
  recipient_ar: 'سارة',
  recipient_en: 'Sara',
  inviter_ar: 'أحمد',
  inviter_en: null,
  organization_ar: 'المنشأة',
  organization_en: 'Org',
  primary_role: 'learner',
};

describe('loadInvitationForMail', () => {
  it('returns what the e-mail needs', async () => {
    const fake = fakeTx([row]);
    await expect(loadInvitationForMail(fake.tx, ID)).resolves.toEqual({
      id: ID,
      status: 'pending',
      sendCount: 1,
      email: 'sara@example.com',
      locale: 'en',
      personId: 'p1',
      recipientName: { ar: 'سارة', en: 'Sara' },
      inviterName: { ar: 'أحمد', en: null },
      organizationName: { ar: 'المنشأة', en: 'Org' },
      primaryRole: 'learner',
    });
    expect(fake.executed[0]?.params).toEqual([ID]);
  });

  it('falls back to the organization as inviter, Arabic as language; null when unknown', async () => {
    const fake = fakeTx([{ ...row, inviter_ar: null, locale: 'xx' }]);
    const mail = await loadInvitationForMail(fake.tx, ID);
    expect(mail?.inviterName).toEqual({ ar: 'المنشأة', en: 'Org' });
    expect(mail?.locale).toBe('ar');
    await expect(loadInvitationForMail(fakeTx([]).tx, ID)).resolves.toBeNull();
  });
});

describe('issueInvitationToken', () => {
  it('stores the hash of a pending invitation under the limit and returns the expiry', async () => {
    const fake = fakeTx([{ expires_at: '2026-10-14 10:00:00+00' }]);
    await expect(issueInvitationToken(fake.tx, ID, HASH)).resolves.toEqual({
      expiresAt: new Date('2026-10-14T10:00:00Z'),
    });
    expect(fake.executed[0]?.sql).toContain("status = 'pending' and send_count < $3");
    expect(fake.executed[0]?.params).toEqual([HASH, ID, 4]);
    const asDate = new Date('2026-10-14T10:00:00Z');
    await expect(
      issueInvitationToken(fakeTx([{ expires_at: asDate }]).tx, ID, HASH),
    ).resolves.toEqual({ expiresAt: asDate });
  });

  it('is null when nothing was updated; refuses a non-SHA-256 hash', async () => {
    await expect(issueInvitationToken(fakeTx([]).tx, ID, HASH)).resolves.toBeNull();
    await expect(issueInvitationToken(fakeTx().tx, ID, Buffer.alloc(4))).rejects.toThrow('SHA-256');
  });
});

describe('invitationActorMayManage', () => {
  const USER = '7d2a9e5b-8f6e-4f58-9f2c-3b2f3f8e2a33';

  it("reads the actor's current roles in the tenant against the invitation's roles", async () => {
    const fake = fakeTx([{ allowed: true }], [{ allowed: false }], []);
    await expect(invitationActorMayManage(fake.tx, ID, USER)).resolves.toBe(true);
    expect(fake.executed[0]?.sql).toContain('private.actor_role_codes(i.tenant_id, $1::uuid)');
    expect(fake.executed[0]?.sql).toContain('x.is_privileged');
    expect(fake.executed[0]?.params).toEqual([USER, ID]);
    await expect(invitationActorMayManage(fake.tx, ID, USER)).resolves.toBe(false);
    // Unknown invitation: no row.
    await expect(invitationActorMayManage(fake.tx, ID, USER)).resolves.toBe(false);
  });

  it('is false for a malformed user id, without a query', async () => {
    const fake = fakeTx([{ allowed: true }]);
    await expect(invitationActorMayManage(fake.tx, ID, 'not-a-uuid')).resolves.toBe(false);
    expect(fake.executed).toHaveLength(0);
  });
});
