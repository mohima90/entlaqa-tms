import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AppDatabase } from './client';
import {
  DEFAULT_LOCKOUT_POLICY,
  changedSettings,
  createPreSessionSecurityApi,
  dismissMfaPrompt,
  getMemberMfa,
  getSecurityPolicy,
  getSessionAccess,
  passwordMinLengthForCaller,
  updateSecurityPolicy,
} from './security';
import type { UserTx } from './with-user-tx';

const dialect = new PgDialect();
const PERSON = '4f6c1a2e-1111-4a5b-8c9d-0123456789ab';
const TENANT = 'a0000000-0000-4000-8000-000000000001';

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
        fakeTx([{ state: 'prompt_grace', mfa_deadline: '2026-10-16T08:00:00Z' }]).tx,
      ),
    ).toEqual({ state: 'prompt_grace', mfaDeadline: new Date('2026-10-16T08:00:00Z') });
    expect(await getSessionAccess(fakeTx([{ state: 'whatever', mfa_deadline: null }]).tx)).toEqual({
      state: 'invalid',
      mfaDeadline: null,
    });
    expect((await getSessionAccess(fakeTx([]).tx)).state).toBe('invalid');
  });

  it('records "not now"; reads a member\'s app; the caller\'s password rule', async () => {
    expect(await dismissMfaPrompt(fakeTx([{ done: true }]).tx)).toBe(true);
    expect(await dismissMfaPrompt(fakeTx([{ done: false }]).tx)).toBe(false);
    const mfa = fakeTx([{ uses_app: true, since: '2026-09-12T08:00:00Z' }]);
    expect(await getMemberMfa(mfa.tx, PERSON)).toEqual({
      usesApp: true,
      since: new Date('2026-09-12T08:00:00Z'),
    });
    expect(mfa.executed[0]?.params).toEqual([PERSON]);
    expect(await getMemberMfa(fakeTx([]).tx, PERSON)).toBeNull();
    expect(await passwordMinLengthForCaller(fakeTx([{ length: 20 }]).tx)).toBe(20);
    expect(await passwordMinLengthForCaller(fakeTx([{ length: null }]).tx)).toBeNull();
    expect(await passwordMinLengthForCaller(fakeTx([]).tx)).toBeNull();
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

  it("lockout settings for the sign-in limiter: the organization's, else the platform default", async () => {
    const { db, executed } = fakeDb([{ lockout_threshold: 7, lockout_minutes: 30 }]);
    const api = createPreSessionSecurityApi(() => db);
    expect(await api.getLockoutPolicy(TENANT)).toEqual({ threshold: 7, minutes: 30 });
    expect(executed.at(-1)?.params).toEqual([TENANT]);
    expect(await api.getLockoutPolicy(null)).toEqual(DEFAULT_LOCKOUT_POLICY);
    expect(await api.getLockoutPolicy('not-a-uuid')).toEqual(DEFAULT_LOCKOUT_POLICY);
    expect(await createPreSessionSecurityApi(() => fakeDb([]).db).getLockoutPolicy(TENANT)).toEqual(
      DEFAULT_LOCKOUT_POLICY,
    );
  });
});
