import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from './client';
import {
  DEFAULT_LOCKOUT_POLICY,
  applyDeviceLimit,
  changedSettings,
  confirmMfaSetup,
  createPreSessionSecurityApi,
  dismissMfaPrompt,
  endMemberSessions,
  endMySessions,
  getMemberMfa,
  getSecurityPolicy,
  getSessionAccess,
  listMemberSessions,
  listMyMfaApps,
  listMySessions,
  loadSessionFacts,
  passwordMinLengthForCaller,
  removeMfaApp,
  requestMfaFactorMail,
  resetMemberMfa,
  updateSecurityPolicy,
} from './security';
import type { UserTx } from './with-user-tx';

const dialect = new PgDialect();
const PERSON = '4f6c1a2e-1111-4a5b-8c9d-0123456789ab';
const SESSION = '9a8b7c6d-2222-4e5f-8a1b-0123456789ab';
const TENANT = 'a0000000-0000-4000-8000-000000000001';
const FACTOR = '5d4b5b0a-3333-4c55-9f4c-0123456789ab';

/** A transaction answering each statement with the next prepared result set. */
function fakeTx(...results: Record<string, unknown>[][]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: (query: SQL) => {
      executed.push(dialect.sqlToQuery(query));
      return Promise.resolve(results.shift() ?? []);
    },
  } as unknown as UserTx;
  return { tx, executed };
}

const row = {
  mfa_mode: 'required_roles',
  mfa_required_roles: ['tenant_admin'],
  mfa_grace_days: 7,
  mfa_prompt_admins: true,
  mfa_required_since: '2026-10-01T08:00:00Z',
  password_min_length: 16,
  lockout_threshold: 5,
  lockout_minutes: 15,
  session_idle_minutes: 30,
  session_max_hours: 12,
  session_max_devices: 3,
  updated_at: '2026-10-02T08:00:00Z',
  version: 4,
};
const settings = {
  mfaMode: 'required_roles' as const,
  mfaRequiredRoles: ['tenant_admin'],
  mfaGraceDays: 7,
  mfaPromptAdmins: true,
  passwordMinLength: 16,
  lockoutThreshold: 5,
  lockoutMinutes: 15,
  sessionIdleMinutes: 30,
  sessionMaxHours: 12,
  sessionMaxDevices: 3,
};

describe('security policy (T-M2-10)', () => {
  it("reads the organization's policy through RLS, with its last editor", async () => {
    const { tx, executed } = fakeTx([
      { ...row, editor_name_ar: 'محمد العتيبي', editor_name_en: null },
    ]);
    expect(await getSecurityPolicy(tx)).toEqual({
      ...settings,
      mfaRequiredSince: new Date('2026-10-01T08:00:00Z'),
      updatedAt: new Date('2026-10-02T08:00:00Z'),
      updatedBy: { nameAr: 'محمد العتيبي', nameEn: null },
      version: 4,
    });
    expect(executed[0]?.sql).toContain('private.current_tenant_id()');
    const defaults = await getSecurityPolicy(
      fakeTx([{ ...row, mfa_required_since: null, editor_name_ar: null }]).tx,
    );
    expect(defaults?.updatedBy).toBeNull();
    expect(defaults?.mfaRequiredSince).toBeNull();
    expect(await getSecurityPolicy(fakeTx([]).tx)).toBeNull();
  });

  it('saves at the expected version only, and tells a conflict from a refusal', async () => {
    const saved = fakeTx([row], [{ ...row, password_min_length: 20 }]);
    expect(await updateSecurityPolicy(saved.tx, { ...settings, passwordMinLength: 20 }, 4)).toEqual(
      {
        outcome: 'updated',
        before: settings,
        after: { ...settings, passwordMinLength: 20 },
      },
    );
    expect(saved.executed[0]?.sql).toContain('for update');
    expect(saved.executed[1]?.sql).toContain('version = $');
    expect(saved.executed[1]?.params).toContain('{tenant_admin}');

    expect(await updateSecurityPolicy(fakeTx([row]).tx, settings, 3)).toEqual({
      outcome: 'conflict',
    });
    expect(await updateSecurityPolicy(fakeTx([]).tx, settings, 4)).toEqual({ outcome: 'refused' });
    // The update policy (Organization Admin at AAL2) filtered the row: nothing changed.
    expect(await updateSecurityPolicy(fakeTx([row], []).tx, settings, 4)).toEqual({
      outcome: 'refused',
    });
  });

  it('names the settings that changed', () => {
    expect(changedSettings(settings, settings)).toEqual([]);
    expect(
      changedSettings(settings, {
        ...settings,
        mfaRequiredRoles: ['hr_manager'],
        sessionMaxDevices: 2,
      }),
    ).toEqual(['mfaRequiredRoles', 'sessionMaxDevices']);
  });
});

describe('session access, MFA and the password rule', () => {
  it("maps the database's state; anything unknown is invalid", async () => {
    expect(
      await getSessionAccess(
        fakeTx([
          {
            state: 'prompt_grace',
            mfa_deadline: '2026-10-16T08:00:00Z',
            uses_app: false,
            mfa_pending: true,
            aal2: false,
          },
        ]).tx,
      ),
    ).toEqual({
      state: 'prompt_grace',
      mfaDeadline: new Date('2026-10-16T08:00:00Z'),
      usesApp: false,
      mfaPending: true,
      aal2: false,
    });
    expect(await getSessionAccess(fakeTx([{ state: 'whatever', mfa_deadline: null }]).tx)).toEqual({
      state: 'invalid',
      mfaDeadline: null,
      usesApp: false,
      mfaPending: false,
      aal2: false,
    });
    expect((await getSessionAccess(fakeTx([]).tx)).state).toBe('invalid');
  });

  it('records "not now"; reads a member\'s app; the caller\'s password rule', async () => {
    expect(await dismissMfaPrompt(fakeTx([{ done: true }]).tx)).toBe(true);
    expect(await dismissMfaPrompt(fakeTx([{ done: false }]).tx)).toBe(false);
    const mfa = fakeTx([{ uses_app: true, since: '2026-09-12T08:00:00Z', pending: false }]);
    expect(await getMemberMfa(mfa.tx, PERSON)).toEqual({
      usesApp: true,
      since: new Date('2026-09-12T08:00:00Z'),
      pending: false,
    });
    expect(mfa.executed[0]?.params).toEqual([PERSON]);
    expect(await getMemberMfa(fakeTx([]).tx, PERSON)).toBeNull();
    expect(await passwordMinLengthForCaller(fakeTx([{ length: 20 }]).tx)).toBe(20);
    expect(await passwordMinLengthForCaller(fakeTx([{ length: null }]).tx)).toBeNull();
    expect(await passwordMinLengthForCaller(fakeTx([]).tx)).toBeNull();
  });
});

describe('authenticator apps and the device limit (review H1, L1; PO answer on resets)', () => {
  it('session facts for defineAction; the device limit after a code', async () => {
    expect(await loadSessionFacts(fakeTx([{ active: true, aal2: false }]).tx)).toEqual({
      active: true,
      aal2: false,
    });
    expect(await loadSessionFacts(fakeTx([]).tx)).toEqual({ active: false, aal2: false });
    expect(await applyDeviceLimit(fakeTx([{ ended: 2 }]).tx)).toBe(2);
    expect(await applyDeviceLimit(fakeTx([]).tx)).toBe(0);
  });

  it('the set-up e-mail and "send again": the database\'s outcome (re-review N1)', async () => {
    const added = fakeTx([{ outcome: 'queued' }]);
    expect(await requestMfaFactorMail(added.tx, FACTOR)).toBe('queued');
    expect(added.executed[0]).toMatchObject({
      sql: 'select private.request_mfa_factor_mail($1::uuid) as outcome',
      params: [FACTOR],
    });
    for (const outcome of ['waiting', 'too_soon', 'refused'] as const) {
      expect(await requestMfaFactorMail(fakeTx([{ outcome }]).tx, FACTOR)).toBe(outcome);
    }
    expect(await requestMfaFactorMail(fakeTx([{ outcome: 'sent' }]).tx, FACTOR)).toBe('refused');
    expect(await requestMfaFactorMail(fakeTx([]).tx, FACTOR)).toBe('refused');
  });

  it('the e-mailed code, entered in the session that set the app up (re-review N1)', async () => {
    const confirmed = fakeTx([{ outcome: 'confirmed' }]);
    expect(await confirmMfaSetup(confirmed.tx, FACTOR, '40718263')).toBe('confirmed');
    expect(confirmed.executed[0]).toMatchObject({
      sql: 'select private.confirm_mfa_setup($1::uuid, $2) as outcome',
      params: [FACTOR, '40718263'],
    });
    for (const outcome of ['invalid', 'expired', 'locked', 'removed', 'refused'] as const) {
      expect(await confirmMfaSetup(fakeTx([{ outcome }]).tx, FACTOR, '00000000')).toBe(outcome);
    }
    expect(await confirmMfaSetup(fakeTx([]).tx, FACTOR, '00000000')).toBe('refused');
  });

  it("the account's apps as this session sees them, and removing one (re-review N1)", async () => {
    const listed = fakeTx([
      {
        factor_id: FACTOR,
        confirmed: false,
        here: false,
        set_up_at: '2026-10-09T08:00:00Z',
        user_agent: 'Mozilla/5.0 Firefox/131.0',
      },
    ]);
    expect(await listMyMfaApps(listed.tx)).toEqual([
      {
        factorId: FACTOR,
        confirmed: false,
        here: false,
        setUpAt: new Date('2026-10-09T08:00:00Z'),
        userAgent: 'Mozilla/5.0 Firefox/131.0',
      },
    ]);
    expect(listed.executed[0]?.sql).toBe(
      'select factor_id, confirmed, here, set_up_at, user_agent from private.my_mfa_apps()',
    );
    expect(await listMyMfaApps(fakeTx([]).tx)).toEqual([]);
    const removed = fakeTx([{ outcome: 'removed' }]);
    expect(await removeMfaApp(removed.tx, FACTOR)).toBe('removed');
    expect(removed.executed[0]).toMatchObject({
      sql: 'select private.remove_mfa_app($1::uuid) as outcome',
      params: [FACTOR],
    });
    expect(await removeMfaApp(fakeTx([{ outcome: 'step_up' }]).tx, FACTOR)).toBe('step_up');
    expect(await removeMfaApp(fakeTx([{ outcome: 'gone' }]).tx, FACTOR)).toBe('refused');
  });

  it("an Organization Admin's reset: the database's outcome, nothing else", async () => {
    for (const outcome of ['reset', 'no_app', 'other_organization', 'self', 'not_found']) {
      expect(await resetMemberMfa(fakeTx([{ outcome }]).tx, PERSON)).toBe(outcome);
    }
    await expect(resetMemberMfa(fakeTx([{ outcome: 'maybe' }]).tx, PERSON)).rejects.toThrow(
      'unknown outcome',
    );
  });
});

describe('before any session (app_server, no claims)', () => {
  function fakeDb(...results: Record<string, unknown>[][]) {
    const { tx, executed } = fakeTx(...[[], [], [], ...results]);
    const db = {
      transaction: (fn: (t: UserTx) => Promise<unknown>) => fn(tx),
    } as unknown as AppDatabase;
    return { db, executed };
  }

  it("a new account's minimum: the invited organization's rule, never below 12", async () => {
    const { db, executed } = fakeDb([{ length: 16 }]);
    const api = createPreSessionSecurityApi(() => db);
    expect(await api.invitationPasswordMinLength(Buffer.alloc(32))).toBe(16);
    expect(executed[1]?.params).toEqual(['']); // no claims
    expect(executed.at(-1)?.sql).toBe(
      'select private.invitation_password_min_length($1::bytea) as length',
    );
    expect(
      await createPreSessionSecurityApi(
        () => fakeDb([{ length: 8 }]).db,
      ).invitationPasswordMinLength(Buffer.alloc(32)),
    ).toBe(12);
    expect(
      await createPreSessionSecurityApi(() => fakeDb([]).db).invitationPasswordMinLength(
        Buffer.alloc(32),
      ),
    ).toBe(12);
  });

  it('the e-mailed "not you" link (review H1)', async () => {
    const reject = fakeDb([{ outcome: 'removed' }]);
    expect(
      await createPreSessionSecurityApi(() => reject.db).rejectMfaFactor(Buffer.alloc(32)),
    ).toBe('removed');
    expect(reject.executed.at(-1)?.sql).toBe(
      'select private.reject_mfa_factor($1::bytea) as outcome',
    );
    expect(
      await createPreSessionSecurityApi(() => fakeDb([{ outcome: 'expired' }]).db).rejectMfaFactor(
        Buffer.alloc(32),
      ),
    ).toBe('expired');
    expect(
      await createPreSessionSecurityApi(
        () => fakeDb([{ outcome: 'confirmed' }]).db,
      ).rejectMfaFactor(Buffer.alloc(32)),
    ).toBe('invalid');
    expect(
      await createPreSessionSecurityApi(() => fakeDb([]).db).rejectMfaFactor(Buffer.alloc(32)),
    ).toBe('invalid');
  });

  it("lockout settings for the sign-in limiter: the organization's, else the platform default", async () => {
    const { db, executed } = fakeDb([{ lockout_threshold: 3, lockout_minutes: 30 }]);
    const api = createPreSessionSecurityApi(() => db);
    expect(await api.getLockoutPolicy(TENANT)).toEqual({ threshold: 3, minutes: 30 });
    expect(executed.at(-1)?.params).toEqual([TENANT]);
    expect(await api.getLockoutPolicy(null)).toEqual(DEFAULT_LOCKOUT_POLICY);
    expect(await api.getLockoutPolicy('not-a-uuid')).toEqual(DEFAULT_LOCKOUT_POLICY);
    expect(await createPreSessionSecurityApi(() => fakeDb([]).db).getLockoutPolicy(TENANT)).toEqual(
      DEFAULT_LOCKOUT_POLICY,
    );
  });
});

describe('sign-in sessions', () => {
  const session = {
    session_id: SESSION,
    started_at: '2026-10-09T08:00:00Z',
    last_active_at: '2026-10-09T09:00:00Z',
    user_agent: 'Mozilla/5.0 Chrome/130.0',
    with_code: true,
    is_current: false,
  };

  it("lists the account's own sessions with their organization", async () => {
    const { tx } = fakeTx([
      { ...session, tenant_name_ar: 'المنشأة', tenant_name_en: 'Org' },
      {
        ...session,
        session_id: 'x',
        is_current: true,
        with_code: false,
        user_agent: null,
        tenant_name_ar: null,
      },
    ]);
    expect(await listMySessions(tx)).toEqual([
      {
        sessionId: SESSION,
        startedAt: new Date('2026-10-09T08:00:00Z'),
        lastActiveAt: new Date('2026-10-09T09:00:00Z'),
        userAgent: 'Mozilla/5.0 Chrome/130.0',
        withCode: true,
        isCurrent: false,
        organization: { nameAr: 'المنشأة', nameEn: 'Org' },
      },
      expect.objectContaining({ isCurrent: true, userAgent: null, organization: null }),
    ]);
  });

  it("ends own and members' sessions through the database functions", async () => {
    const own = fakeTx([{ ended: 2 }]);
    expect(await endMySessions(own.tx, null)).toBe(2);
    expect(own.executed[0]?.params).toEqual([null]);
    const member = fakeTx([session], [{ ended: 1 }]);
    expect((await listMemberSessions(member.tx, PERSON))[0]?.sessionId).toBe(SESSION);
    expect(await endMemberSessions(member.tx, PERSON, SESSION)).toBe(1);
    expect(member.executed[1]?.params).toEqual([PERSON, SESSION]);
    expect(await endMySessions(fakeTx([]).tx, SESSION)).toBe(0);
  });
});
