import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { DomainError, isDomainError } from './domain-error';
import {
  INVITATION_EVENTS,
  acceptInvitationAsCaller,
  createInvitation,
  createInvitationTokenApi,
  getInvitationRoles,
  hashInvitationToken,
  invitationErrorOf,
  listInvitations,
  requestInvitationResend,
  revokeInvitation,
} from './invitations';

const dialect = new PgDialect();
const ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
const PERSON = '6c1f8d4a-7e5d-4e47-8e1b-2a1e2e7d1f22';
const HASH = hashInvitationToken('token');

type Answer = unknown[] | Error;

/** Answers each statement with the next answer (an Error rejects); records SQL and parameters. */
function fakeTx(...answers: Answer[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        executed.push(dialect.sqlToQuery(query));
        const next = answers.shift() ?? [];
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    } as never,
  };
}

/** A database whose transactions run on a fake tx (after the three claim-setting statements). */
function fakeDb(...answers: Answer[]) {
  const fake = fakeTx([], [], [], ...answers);
  return { ...fake, db: { transaction: (fn: (tx: unknown) => unknown) => fn(fake.tx) } as never };
}

const pgErr = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`pg ${code}`), { code, ...extra });

const input = {
  email: '  Sara@Example.COM ',
  firstNameAr: ' سارة ',
  familyNameAr: 'الأحمد',
  firstNameEn: 'Sara',
  familyNameEn: null,
  departmentId: null,
  branchId: null,
  managerPersonId: null,
  employeeNumber: ' ',
  primaryRole: 'learner',
  additionalRoles: ['mentor', 'line_manager'],
  locale: 'ar' as const,
};

describe('hashInvitationToken', () => {
  it('is the SHA-256 of the UTF-8 bytes', () => {
    expect(hashInvitationToken('abc').toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashInvitationToken('مرحبا')).toHaveLength(32);
  });
});

describe('createInvitation', () => {
  it('creates the person, placement, invitation and event', async () => {
    const fake = fakeTx([{ id: PERSON }], [], [{ id: ID }], []);
    await expect(createInvitation(fake.tx, input)).resolves.toEqual({
      invitationId: ID,
      personId: PERSON,
    });
    expect(fake.executed[0]?.params).toEqual([
      'سارة الأحمد',
      'Sara',
      'سارة',
      'الأحمد',
      'Sara',
      null,
      'sara@example.com',
      null,
      'ar',
    ]);
    expect(fake.executed[1]?.sql).toContain('insert into platform.person_employment');
    expect(fake.executed[2]?.sql).toContain('array[$5, $6]::text[]');
    expect(fake.executed[2]?.params).toEqual([
      PERSON,
      'sara@example.com',
      'ar',
      'learner',
      'mentor',
      'line_manager',
    ]);
    expect(fake.executed[3]?.sql).toContain('insert into platform.event_outbox');
    expect(fake.executed[3]?.params).toContain(INVITATION_EVENTS.created);
    expect(fake.executed[3]?.params).toContain(ID);
  });

  it('passes no additional roles as an empty array', async () => {
    const fake = fakeTx([{ id: PERSON }], [], [{ id: ID }], []);
    await createInvitation(fake.tx, { ...input, additionalRoles: [], firstNameEn: null });
    expect(fake.executed[0]?.params[1]).toBeNull();
    expect(fake.executed[2]?.sql).toContain("'{}'::text[]");
  });

  it.each([
    [pgErr('23505', { constraint_name: 'persons_tenant_email_uq' }), 'EMAIL_TAKEN'],
    [pgErr('23505', { constraint_name: 'invitations_pending_email_uq' }), 'EMAIL_TAKEN'],
    [
      pgErr('23505', { constraint_name: 'persons_tenant_employee_number_uq' }),
      'EMPLOYEE_NUMBER_TAKEN',
    ],
    [pgErr('42501'), 'ROLE_NOT_ALLOWED'],
    // Separation of duties (BR-IAM-4, T-M2-16).
    [pgErr('JR001'), 'ROLE_CONFLICT'],
  ])('maps database refusals to DomainErrors (%#)', async (error, code) => {
    const failure = await createInvitation(fakeTx(error).tx, input).catch((e: unknown) => e);
    expect(isDomainError(failure, code)).toBe(true);
    expect((failure as DomainError).cause).toBe(error);
  });

  it('rethrows anything else, and fails when nothing is returned', async () => {
    const other = pgErr('23514');
    await expect(createInvitation(fakeTx(other).tx, input)).rejects.toBe(other);
    await expect(createInvitation(fakeTx([]).tx, input)).rejects.toThrow('no person');
    await expect(createInvitation(fakeTx([{ id: PERSON }], [], []).tx, input)).rejects.toThrow(
      'no invitation',
    );
    expect(invitationErrorOf(pgErr('23505', { constraint_name: 'other' }))).toBeInstanceOf(Error);
    expect(invitationErrorOf('x')).toBe('x');
  });
});

describe('listInvitations', () => {
  const row = {
    id: ID,
    person_id: PERSON,
    email: 'sara@example.com',
    display_name_ar: 'سارة',
    display_name_en: null,
    primary_role: 'learner',
    state: 'expired',
    send_count: 2,
    expires_at: '2026-10-07 10:00:00+00',
    created_at: new Date('2026-09-30T10:00:00Z'),
  };

  it('maps rows and computes the state in SQL', async () => {
    const fake = fakeTx([row]);
    const [r] = await listInvitations(fake.tx);
    expect(r).toEqual({
      id: ID,
      personId: PERSON,
      email: 'sara@example.com',
      displayNameAr: 'سارة',
      displayNameEn: null,
      primaryRole: 'learner',
      state: 'expired',
      sendCount: 2,
      expiresAt: new Date('2026-10-07T10:00:00Z'),
      createdAt: new Date('2026-09-30T10:00:00Z'),
    });
    expect(fake.executed[0]?.sql).toContain("then 'expired'");
    expect(fake.executed[0]?.sql).toContain('where true');
  });

  it('filters by state', async () => {
    const fake = fakeTx([]);
    await expect(listInvitations(fake.tx, { state: 'pending' })).resolves.toEqual([]);
    expect(fake.executed[0]?.params).toEqual(['pending']);
  });
});

describe('revokeInvitation', () => {
  it('revokes a pending invitation and emits the event', async () => {
    const fake = fakeTx([{ id: ID }], []);
    await expect(revokeInvitation(fake.tx, ID)).resolves.toBe(true);
    expect(fake.executed[0]?.sql).toContain("status = 'pending'");
    expect(fake.executed[1]?.params).toContain(INVITATION_EVENTS.revoked);
  });

  it('is false when not pending, and maps a refused actor', async () => {
    const fake = fakeTx([]);
    await expect(revokeInvitation(fake.tx, ID)).resolves.toBe(false);
    expect(fake.executed).toHaveLength(1);
    const failure = await revokeInvitation(fakeTx(pgErr('42501')).tx, ID).catch((e: unknown) => e);
    expect(isDomainError(failure, 'ROLE_NOT_ALLOWED')).toBe(true);
  });
});

describe('requestInvitationResend', () => {
  it('records the request through the checked column update, then emits the event', async () => {
    const fake = fakeTx([{ id: ID }], []);
    await expect(requestInvitationResend(fake.tx, ID)).resolves.toBe('queued');
    expect(fake.executed[0]?.sql).toContain(
      'update platform.invitations set resend_requested_at = clock_timestamp()',
    );
    expect(fake.executed[0]?.sql).toContain("status = 'pending'");
    expect(fake.executed[0]?.params).toEqual([ID, 4]);
    expect(fake.executed[1]?.params).toContain(INVITATION_EVENTS.resendRequested);
  });

  it('refuses at the limit or when not pending, without an event', async () => {
    const atLimit = fakeTx([], [{ status: 'pending', send_count: 4 }]);
    await expect(requestInvitationResend(atLimit.tx, ID)).resolves.toBe('limit_reached');
    expect(atLimit.executed).toHaveLength(2);
    await expect(
      requestInvitationResend(fakeTx([], [{ status: 'revoked', send_count: 1 }]).tx, ID),
    ).resolves.toBe('not_pending');
    await expect(requestInvitationResend(fakeTx([], []).tx, ID)).resolves.toBe('not_pending');
  });

  it('maps a refused actor (e.g. HR on a privileged invitation) to ROLE_NOT_ALLOWED', async () => {
    const failure = await requestInvitationResend(fakeTx(pgErr('42501')).tx, ID).catch(
      (e: unknown) => e,
    );
    expect(isDomainError(failure, 'ROLE_NOT_ALLOWED')).toBe(true);
    const other = new Error('connection lost');
    await expect(requestInvitationResend(fakeTx(other).tx, ID)).rejects.toBe(other);
  });
});

describe('getInvitationRoles', () => {
  it('returns the roles of a visible invitation, or null', async () => {
    const fake = fakeTx([{ primary_role: 'auditor', additional_roles: ['learner'] }], []);
    await expect(getInvitationRoles(fake.tx, ID)).resolves.toEqual({
      primaryRole: 'auditor',
      additionalRoles: ['learner'],
    });
    expect(fake.executed[0]?.params).toEqual([ID]);
    await expect(getInvitationRoles(fake.tx, ID)).resolves.toBeNull();
  });
});

describe('invitationByToken', () => {
  it('runs without claims and maps a valid link', async () => {
    const fake = fakeDb([
      {
        state: 'valid',
        tenant_name_ar: 'المنشأة',
        tenant_name_en: null,
        email: 'sara@example.com',
        display_name_ar: 'سارة',
        display_name_en: 'Sara',
        locale: 'en',
      },
    ]);
    const api = createInvitationTokenApi(() => fake.db);
    await expect(api.invitationByToken(HASH)).resolves.toEqual({
      state: 'valid',
      email: 'sara@example.com',
      locale: 'en',
      organizationName: { ar: 'المنشأة', en: null },
      displayName: { ar: 'سارة', en: 'Sara' },
    });
    expect(fake.executed[0]?.sql).toBe('set local role authenticated');
    expect(fake.executed[1]?.params).toEqual(['']);
    expect(fake.executed[3]?.sql).toContain('private.invitation_by_token($1::bytea)');
    expect(fake.executed[3]?.params).toEqual([HASH]);
  });

  it.each(['expired', 'revoked', 'used', 'invalid'] as const)('maps %s', async (state) => {
    const fake = fakeDb([{ state }]);
    await expect(createInvitationTokenApi(() => fake.db).invitationByToken(HASH)).resolves.toEqual({
      state,
    });
  });

  it('reads anything else as invalid, and never queries for a malformed hash', async () => {
    const empty = fakeDb([]);
    await expect(createInvitationTokenApi(() => empty.db).invitationByToken(HASH)).resolves.toEqual(
      { state: 'invalid' },
    );
    const unused = fakeDb();
    await expect(
      createInvitationTokenApi(() => unused.db).invitationByToken(Buffer.from('short')),
    ).resolves.toEqual({ state: 'invalid' });
    expect(unused.executed).toHaveLength(0);
  });
});

describe('acceptInvitationAsCaller', () => {
  it('accepts in the caller transaction (no display names by default)', async () => {
    const fake = fakeTx([{ tenant_id: ID }]);
    await expect(acceptInvitationAsCaller(fake.tx, HASH)).resolves.toEqual({ tenantId: ID });
    expect(fake.executed[0]?.sql).toContain('private.accept_invitation_as_caller($1::bytea, $2,');
    expect(fake.executed[0]?.params).toEqual([HASH, null, null]);
  });

  it('passes the display names chosen on the page', async () => {
    const fake = fakeTx([{ tenant_id: ID }]);
    await acceptInvitationAsCaller(fake.tx, HASH, { ar: 'سارة', en: null });
    expect(fake.executed[0]?.params).toEqual([HASH, 'سارة', null]);
  });

  it.each([
    ['JI001', 'INVITATION_NOT_VALID'],
    ['JI002', 'ALREADY_MEMBER'],
    ['JI003', 'INVITATION_ACCOUNT_MISMATCH'],
    ['23514', 'INVITATION_NOT_VALID'],
    ['JR001', 'INVITATION_NOT_VALID'],
  ])('maps %s to %s', async (sqlstate, code) => {
    const failure = await acceptInvitationAsCaller(fakeTx(pgErr(sqlstate)).tx, HASH).catch(
      (e: unknown) => e,
    );
    expect(isDomainError(failure, code)).toBe(true);
  });

  it('refuses a malformed hash and rethrows other failures', async () => {
    await expect(acceptInvitationAsCaller(fakeTx().tx, Buffer.alloc(1))).rejects.toBeInstanceOf(
      DomainError,
    );
    const other = pgErr('42501');
    await expect(acceptInvitationAsCaller(fakeTx(other).tx, HASH)).rejects.toBe(other);
    await expect(acceptInvitationAsCaller(fakeTx([]).tx, HASH)).rejects.toThrow('no result');
  });
});

describe('DomainError', () => {
  it('carries the code as message and is recognised by code', () => {
    const error = new DomainError('EMAIL_TAKEN');
    expect(error.message).toBe('EMAIL_TAKEN');
    expect(error.name).toBe('DomainError');
    expect(isDomainError(error)).toBe(true);
    expect(isDomainError(error, 'ROLE_NOT_ALLOWED')).toBe(false);
    expect(isDomainError(new Error('EMAIL_TAKEN'))).toBe(false);
  });
});
