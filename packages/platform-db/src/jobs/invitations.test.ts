import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  invitationActorMayManage,
  invitationCodeForMail,
  loadInvitationForMail,
} from './invitations';

const dialect = new PgDialect();
const ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';

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
  invited_by: 'u1',
  send_requested_by: 'u2',
  mail_held: false,
  expires_at: '2026-10-14 10:00:00+00',
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
      invitedBy: 'u1',
      sendRequestedBy: 'u2',
      mailHeld: false,
      expiresAt: new Date('2026-10-14T10:00:00Z'),
    });
    expect(fake.executed[0]?.params).toEqual([ID]);
    // The inviter shown is the member it is sent for (integration review M2).
    expect(fake.executed[0]?.sql).toContain(
      'm.user_id = coalesce(i.send_requested_by, i.invited_by)',
    );
  });

  it('falls back to the organization as inviter, Arabic as language; null when unknown', async () => {
    const fake = fakeTx([{ ...row, inviter_ar: null, locale: 'xx' }]);
    const mail = await loadInvitationForMail(fake.tx, ID);
    expect(mail?.inviterName).toEqual({ ar: 'المنشأة', en: 'Org' });
    expect(mail?.locale).toBe('ar');
    const asDate = new Date('2026-10-14T10:00:00Z');
    await expect(
      loadInvitationForMail(fakeTx([{ ...row, expires_at: asDate }]).tx, ID),
    ).resolves.toMatchObject({ expiresAt: asDate });
    await expect(loadInvitationForMail(fakeTx([]).tx, ID)).resolves.toBeNull();
  });
});

describe('invitationCodeForMail', () => {
  it('reads the current code through the jobs-only definer function', async () => {
    const fake = fakeTx([{ code: 'K7M2PQ9X' }], [{ code: null }], []);
    await expect(invitationCodeForMail(fake.tx, ID)).resolves.toBe('K7M2PQ9X');
    expect(fake.executed[0]?.sql).toContain('private.invitation_code_for_mail($1::uuid)');
    expect(fake.executed[0]?.params).toEqual([ID]);
    await expect(invitationCodeForMail(fake.tx, ID)).resolves.toBeNull();
    await expect(invitationCodeForMail(fake.tx, ID)).resolves.toBeNull();
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
