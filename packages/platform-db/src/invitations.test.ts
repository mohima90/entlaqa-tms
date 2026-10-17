import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { forgetSchemaPresenceForTests } from './custom-roles-present';
import { DomainError, isDomainError } from './domain-error';
import {
  INVITATION_CODE_ALPHABET,
  INVITATION_CODE_PATTERN,
  INVITATION_EVENTS,
  INVITATION_SECRET_PATTERN,
  acceptInvitationAsCaller,
  createInvitation,
  createInvitationTokenApi,
  formatInvitationCode,
  getInvitationRoles,
  hashInvitationToken,
  invitationCode,
  invitationErrorOf,
  listInvitations,
  normalizeInvitationCode,
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
  const tx = {
    execute: (query: SQL) => {
      const q = dialect.sqlToQuery(query);
      // The custom-roles catalog check (deploy window): answered here, not recorded — unless the
      // test queued its own answer ({ present }).
      // The skipped e-mails' function (WP-ADM-01, T-M2-20): present.
      if (q.sql.includes("to_regprocedure('private.invitation_mail_skipped_ids()')")) {
        return Promise.resolve([{ present: true }]);
      }
      if (q.sql.includes('to_regclass(')) {
        const queued = answers[0];
        const first = Array.isArray(queued)
          ? (queued[0] as Record<string, unknown> | undefined)
          : undefined;
        return Promise.resolve(
          first && 'present' in first ? (answers.shift() ?? []) : [{ present: true }],
        );
      }
      executed.push(q);
      const next = answers.shift() ?? [];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    // A savepoint runs on the same fake.
    transaction: (fn: (savepoint: unknown) => unknown) => fn(tx),
  };
  return {
    executed,
    tx: tx as never,
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

describe('invitation codes', () => {
  it('match the database alphabet and length: 12 of 32 symbols (60 bits), no 0/O or 1/I', () => {
    expect(INVITATION_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(INVITATION_CODE_ALPHABET).size).toBe(32);
    for (const symbol of INVITATION_CODE_ALPHABET) {
      expect(INVITATION_CODE_PATTERN.test(symbol.repeat(12))).toBe(true);
      expect(INVITATION_CODE_PATTERN.test(symbol.repeat(8))).toBe(false);
    }
    for (const symbol of ['0', 'O', '1', 'I', 'a', '-', '_']) {
      expect(INVITATION_CODE_PATTERN.test(`${symbol}BCDEFGHJKLM`)).toBe(false);
    }
    expect(INVITATION_SECRET_PATTERN.test('K7M2PQ9XHT4W')).toBe(true);
    expect(INVITATION_SECRET_PATTERN.test('K7M2PQ9X')).toBe(false);
  });

  it('normalizes what was typed: grouping removed, upper-cased; legacy tokens unchanged', () => {
    expect(normalizeInvitationCode(' k7m2pq9xht4w ')).toBe('K7M2PQ9XHT4W');
    expect(normalizeInvitationCode('K7M2-PQ9X-HT4W')).toBe('K7M2PQ9XHT4W');
    expect(normalizeInvitationCode('k7m2 pq9x ht4w')).toBe('K7M2PQ9XHT4W');
    expect(normalizeInvitationCode('K7M2–PQ9X–HT4W')).toBe('K7M2PQ9XHT4W');
    const legacy = `${'aB_-'.repeat(10)}xyz`;
    expect(legacy).toHaveLength(43);
    expect(normalizeInvitationCode(legacy)).toBe(legacy);
    for (const bad of [
      '',
      'K7M2PQ9X',
      'K7M2PQ9XHT4',
      'K7M2PQ9XHT4WZ',
      'K7M2PQ9XHT4O',
      'K7M2PQ9XHT41',
      'K7M2_PQ9X_HT4W',
      'كودكودكودكود',
    ]) {
      expect(normalizeInvitationCode(bad)).toBeNull();
    }
  });

  it('displays a code grouped XXXX-XXXX-XXXX', () => {
    expect(formatInvitationCode('K7M2PQ9XHT4W')).toBe('K7M2-PQ9X-HT4W');
    expect(formatInvitationCode('K7M2PQ')).toBe('K7M2-PQ');
    const legacy = 'A'.repeat(43);
    expect(formatInvitationCode(legacy)).toBe(legacy);
  });
});

describe('createInvitation', () => {
  it('creates the person, placement, invitation, its first code and event', async () => {
    const fake = fakeTx([{ id: PERSON }], [], [{ id: ID }], [{ code: 'K7M2PQ9XHT4W' }], []);
    await expect(createInvitation(fake.tx, input)).resolves.toEqual({
      invitationId: ID,
      personId: PERSON,
      inviteCode: 'K7M2PQ9XHT4W',
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
    // The code is issued by the database (actor-checked definer function), never chosen here.
    expect(fake.executed[3]?.sql).toContain('private.issue_invitation_code($1::uuid)');
    expect(fake.executed[3]?.params).toEqual([ID]);
    expect(fake.executed[4]?.sql).toContain('insert into platform.event_outbox');
    expect(fake.executed[4]?.params).toContain(INVITATION_EVENTS.created);
    expect(fake.executed[4]?.params).toContain(ID);
  });

  it('passes no additional roles as an empty array', async () => {
    const fake = fakeTx([{ id: PERSON }], [], [{ id: ID }], [{ code: 'K7M2PQ9XHT4W' }], []);
    await createInvitation(fake.tx, { ...input, additionalRoles: [], firstNameEn: null });
    expect(fake.executed[0]?.params[1]).toBeNull();
    expect(fake.executed[2]?.sql).toContain("'{}'::text[]");
  });

  it('English names only: no Arabic display name — the English one before migration 20261021090000', async () => {
    forgetSchemaPresenceForTests();
    const english = { ...input, firstNameAr: null, familyNameAr: ' ', familyNameEn: 'Alahmad' };
    const answers = (): Answer[] => [
      [{ id: PERSON }],
      [],
      [{ id: ID }],
      [{ code: 'K7M2PQ9XHT4W' }],
      [],
    ];
    // The database still refuses a person without an Arabic display name: the English one fills it.
    const early = fakeTx([{ present: false }], ...answers());
    await createInvitation(early.tx, english);
    expect(early.executed[0]?.params.slice(0, 6)).toEqual([
      'Sara Alahmad',
      'Sara Alahmad',
      null,
      null,
      'Sara',
      'Alahmad',
    ]);
    // Once the migration ran: no Arabic display name (and the catalog is not asked again).
    const later = fakeTx([{ present: true }], ...answers());
    await createInvitation(later.tx, english);
    expect(later.executed[0]?.params.slice(0, 2)).toEqual([null, 'Sara Alahmad']);
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
    await expect(
      createInvitation(fakeTx([{ id: PERSON }], [], [{ id: ID }], []).tx, input),
    ).rejects.toThrow('no code');
    const collision = pgErr('23505', { constraint_name: 'invitations_invite_code_uq' });
    expect(invitationErrorOf(collision)).toBe(collision);
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
    import_id: null,
    has_code: true,
    locale: 'en',
    additional_roles: ['mentor'],
    role_name_ar: null,
    role_name_en: null,
    privileged: false,
    mail_not_sent: false,
  };

  it('maps rows, computes the state in SQL and says whether a code may be copied (never the code)', async () => {
    const fake = fakeTx([row]);
    const [r] = await listInvitations(fake.tx);
    expect(r).toEqual({
      id: ID,
      personId: PERSON,
      email: 'sara@example.com',
      displayNameAr: 'سارة',
      displayNameEn: null,
      primaryRole: 'learner',
      primaryRoleName: null,
      privileged: false,
      state: 'expired',
      sendCount: 2,
      expiresAt: new Date('2026-10-07T10:00:00Z'),
      createdAt: new Date('2026-09-30T10:00:00Z'),
      importId: null,
      additionalRoles: ['mentor'],
      hasCode: true,
      locale: 'en',
      mailNotSent: false,
    });
    // T-M2-20: the code was not e-mailed (the mailer skipped it) — the list says so.
    const [skipped] = await listInvitations(fakeTx([{ ...row, mail_not_sent: true }]).tx);
    expect(skipped?.mailNotSent).toBe(true);
    expect(fake.executed[0]?.sql).toContain(
      'from private.invitation_mail_skipped_ids() x) k on k.id = i.id',
    );
    // Custom roles (EP-ROLES): their names, and whether the role is privileged, computed in SQL.
    const [custom] = await listInvitations(
      fakeTx([{ ...row, role_name_ar: 'مدقق', role_name_en: 'Auditor', privileged: true }]).tx,
    );
    expect(custom).toMatchObject({
      primaryRoleName: { ar: 'مدقق', en: 'Auditor' },
      privileged: true,
    });
    expect(fake.executed[0]?.sql).toContain('private.roles_include_privileged(i.tenant_id');
    expect(fake.executed[0]?.sql).toContain(
      'left join (select x.invitation_id from private.invitation_codes() x) c',
    );
    expect(fake.executed[0]?.sql).not.toContain('c.invite_code');
    expect(fake.executed[0]?.sql).toContain("then 'expired'");
    expect(fake.executed[0]?.sql).toContain('where true');
  });

  it('reads no custom role names before their table exists (deploy window, review Low 3)', async () => {
    const fake = fakeTx([{ present: false }], [row]);
    const [r] = await listInvitations(fake.tx);
    expect(r?.primaryRoleName).toBeNull();
    expect(fake.executed[0]?.sql).not.toContain('custom_roles');
  });

  it('filters by state', async () => {
    const fake = fakeTx([]);
    await expect(listInvitations(fake.tx, { state: 'pending' })).resolves.toEqual([]);
    expect(fake.executed[0]?.params).toEqual(['pending']);
  });

  it('defaults missing additional roles to none', async () => {
    const [r] = await listInvitations(fakeTx([{ ...row, additional_roles: null }]).tx);
    expect(r?.additionalRoles).toEqual([]);
  });
});

describe('invitationCode', () => {
  it("reads one invitation's code through the checked database function", async () => {
    const fake = fakeTx([{ invite_code: 'K7M2PQ9XHT4W', locale: 'en' }]);
    await expect(invitationCode(fake.tx, ID)).resolves.toEqual({
      inviteCode: 'K7M2PQ9XHT4W',
      locale: 'en',
    });
    expect(fake.executed[0]?.sql).toContain('private.invitation_codes(array[$1::uuid])');
    expect(fake.executed[0]?.params).toEqual([ID]);
    await expect(
      invitationCode(fakeTx([{ invite_code: 'K7M2PQ9XHT4W', locale: 'ar' }]).tx, ID),
    ).resolves.toEqual({ inviteCode: 'K7M2PQ9XHT4W', locale: 'ar' });
  });

  it('is null when there is none the caller may copy', async () => {
    await expect(invitationCode(fakeTx([]).tx, ID)).resolves.toBeNull();
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
  it('issues a new code through the checked database function, then emits the event', async () => {
    const fake = fakeTx([{ code: 'NEWCQDE2HT4W' }], []);
    await expect(requestInvitationResend(fake.tx, ID)).resolves.toEqual({
      status: 'queued',
      inviteCode: 'NEWCQDE2HT4W',
    });
    expect(fake.executed[0]?.sql).toContain('private.issue_invitation_code($1::uuid)');
    expect(fake.executed[0]?.params).toEqual([ID]);
    expect(fake.executed[1]?.params).toContain(INVITATION_EVENTS.resendRequested);
  });

  it('refuses at the limit or when not pending, without an event', async () => {
    const atLimit = fakeTx(pgErr('JI004'));
    await expect(requestInvitationResend(atLimit.tx, ID)).resolves.toEqual({
      status: 'limit_reached',
    });
    expect(atLimit.executed).toHaveLength(1);
    const notPending = fakeTx(pgErr('JI005'));
    await expect(requestInvitationResend(notPending.tx, ID)).resolves.toEqual({
      status: 'not_pending',
    });
    expect(notPending.executed).toHaveLength(1);
    await expect(requestInvitationResend(fakeTx([]).tx, ID)).rejects.toThrow('no code');
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
