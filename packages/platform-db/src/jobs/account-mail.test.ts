import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  accountHasApp,
  claimAccountMailRequest,
  finishAccountMailRequest,
  issueMfaFactorTokens,
  loadAccountMailContext,
  loadPersonName,
  purgeEndedSessions,
  purgeUnconfirmedMfaApps,
  retryAccountMailRequest,
} from './account-mail';

const dialect = new PgDialect();
const ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
const USER = '6c1f8d4a-7e5d-4e47-8e1b-2a1e2e7d1f22';
const TENANT = '7d2a9e5b-8f6e-4f58-9f2c-3b2f3f8e2a33';
const PERSON = '8e3b0f6c-9a7f-4a69-8a3d-4c3a4a9f3b44';
const FACTOR = '9f4c1a7d-0b8a-4b7a-9b4e-5d4b5b0a4c55';

function fakeTx(...answers: unknown[][]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        executed.push(dialect.sqlToQuery(query));
        return Promise.resolve(answers.shift() ?? []);
      },
    } as never,
  };
}

const row = (overrides: Record<string, unknown>) => ({
  id: ID,
  kind: 'password_reset',
  outcome: 'send',
  email: 'sara@example.test',
  user_id: USER,
  tenant_id: TENANT,
  person_id: PERSON,
  locale: 'en',
  attempts: 1,
  factor_id: null,
  mfa_reason: null,
  detail: null,
  ...overrides,
});
const none = { factorId: null, mfaReason: null, policyChange: null };

describe('account e-mail queue, worker side (T-M2-17)', () => {
  it('a lease to send: recipient, organization, person and language', async () => {
    const fake = fakeTx([row({})]);
    expect(await claimAccountMailRequest(fake.tx)).toEqual({
      id: ID,
      kind: 'password_reset',
      attempt: 1,
      outcome: 'send',
      email: 'sara@example.test',
      userId: USER,
      tenantId: TENANT,
      personId: PERSON,
      locale: 'en',
      ...none,
    });
    expect(fake.executed[0]?.sql).toBe('select * from private.claim_account_mail_request()');
    // Anything but English is Arabic.
    const ar = await claimAccountMailRequest(fakeTx([row({ locale: 'fr' })]).tx);
    expect(ar).toMatchObject({ locale: 'ar' });
  });

  it('a lease without e-mail carries only why; nothing waiting is null', async () => {
    for (const outcome of ['unknown_account', 'banned', 'too_soon', 'no_membership']) {
      expect(
        await claimAccountMailRequest(
          fakeTx([row({ kind: 'password_changed', outcome, email: null, attempts: 2 })]).tx,
        ),
      ).toEqual({ id: ID, kind: 'password_changed', attempt: 2, outcome, ...none });
    }
    expect(await claimAccountMailRequest(fakeTx([]).tx)).toBeNull();
  });

  it('authenticator notices carry the app and why; policy notices what changed (T-M2-10)', async () => {
    expect(
      await claimAccountMailRequest(
        fakeTx([row({ kind: 'mfa_factor_added', factor_id: FACTOR })]).tx,
      ),
    ).toMatchObject({ kind: 'mfa_factor_added', factorId: FACTOR, mfaReason: null });
    expect(
      await claimAccountMailRequest(
        fakeTx([row({ kind: 'mfa_factor_removed', mfa_reason: 'admin_reset' })]).tx,
      ),
    ).toMatchObject({ kind: 'mfa_factor_removed', factorId: null, mfaReason: 'admin_reset' });
    await expect(
      claimAccountMailRequest(fakeTx([row({ kind: 'mfa_factor_removed' })]).tx),
    ).rejects.toThrow('removal without a reason');
    const detail = {
      changed: ['mfaMode', 'passwordMinLength'],
      changed_by: PERSON,
      changed_at: '2026-10-09T08:00:00Z',
    };
    expect(
      await claimAccountMailRequest(fakeTx([row({ kind: 'security_policy_changed', detail })]).tx),
    ).toMatchObject({
      policyChange: {
        changed: ['mfaMode', 'passwordMinLength'],
        changedByPersonId: PERSON,
        changedAt: new Date('2026-10-09T08:00:00Z'),
      },
    });
    for (const bad of [
      null,
      { changed: [] },
      { changed: ['x y'], changed_at: 'now' },
      { changed: ['a'] },
    ]) {
      await expect(
        claimAccountMailRequest(fakeTx([row({ kind: 'security_policy_changed', detail: bad })]).tx),
      ).rejects.toThrow('policy change without its detail');
    }
  });

  it('the set-up code and link, whether an account has an app, the purges (T-M2-10)', async () => {
    const issued = fakeTx([
      {
        code_expires_at: '2026-10-12T08:00:00Z',
        remove_expires_at: '2026-10-16T08:00:00Z',
        set_up_at: '2026-10-09T08:00:00Z',
        setup_user_agent: 'Mozilla/5.0 Firefox/131.0',
      },
    ]);
    expect(
      await issueMfaFactorTokens(issued.tx, FACTOR, USER, Buffer.alloc(32, 1), Buffer.alloc(32, 2)),
    ).toEqual({
      codeExpiresAt: new Date('2026-10-12T08:00:00Z'),
      removeExpiresAt: new Date('2026-10-16T08:00:00Z'),
      setUpAt: new Date('2026-10-09T08:00:00Z'),
      setupUserAgent: 'Mozilla/5.0 Firefox/131.0',
    });
    expect(issued.executed[0]?.params.slice(0, 2)).toEqual([FACTOR, USER]);
    expect(issued.executed[0]?.sql).toContain('private.issue_mfa_factor_tokens(');
    expect(
      await issueMfaFactorTokens(
        fakeTx([{ code_expires_at: null, remove_expires_at: null }]).tx,
        FACTOR,
        USER,
        Buffer.alloc(32),
        Buffer.alloc(32),
      ),
    ).toBeNull();
    expect(await accountHasApp(fakeTx([{ has_app: true }]).tx, USER)).toBe(true);
    expect(await accountHasApp(fakeTx([]).tx, USER)).toBe(false);
    const purged = fakeTx([{ purged: '3' }]);
    expect(await purgeEndedSessions(purged.tx, 500)).toBe(3);
    expect(purged.executed[0]?.params).toEqual([500]);
    expect(await purgeEndedSessions(fakeTx([]).tx, 500)).toBe(0);
    const apps = fakeTx([{ purged: 2 }]);
    expect(await purgeUnconfirmedMfaApps(apps.tx, 100)).toBe(2);
    expect(apps.executed[0]).toMatchObject({
      sql: 'select private.purge_unconfirmed_mfa_apps($1::integer) as purged',
      params: [100],
    });
    expect(await loadPersonName(fakeTx([{ name_ar: 'سارة', name_en: null }]).tx, PERSON)).toEqual({
      ar: 'سارة',
      en: null,
    });
    expect(await loadPersonName(fakeTx([]).tx, PERSON)).toBeNull();
  });

  it('refuses answers it does not understand', async () => {
    await expect(claimAccountMailRequest(fakeTx([row({ kind: 'x' })]).tx)).rejects.toThrow(
      'unknown request kind',
    );
    await expect(claimAccountMailRequest(fakeTx([row({ outcome: 'x' })]).tx)).rejects.toThrow(
      'unknown outcome',
    );
    await expect(claimAccountMailRequest(fakeTx([row({ person_id: null })]).tx)).rejects.toThrow(
      'incomplete recipient',
    );
  });

  it('finish and retry say whether the request is still there', async () => {
    const finished = fakeTx([{ done: true }]);
    expect(await finishAccountMailRequest(finished.tx, ID)).toBe(true);
    expect(finished.executed[0]).toMatchObject({
      sql: 'select private.finish_account_mail_request($1::uuid) as done',
      params: [ID],
    });
    expect(await finishAccountMailRequest(fakeTx([{ done: false }]).tx, ID)).toBe(false);
    const retried = fakeTx([{ again: true }]);
    expect(await retryAccountMailRequest(retried.tx, ID)).toBe(true);
    expect(retried.executed[0]?.sql).toBe(
      'select private.retry_account_mail_request($1::uuid) as again',
    );
    expect(await retryAccountMailRequest(fakeTx([]).tx, ID)).toBe(false);
  });

  it('loads the names for the e-mail and the hourly count, in the tenant transaction', async () => {
    const fake = fakeTx([
      {
        organization_ar: 'شركة الراية',
        organization_en: null,
        recipient_ar: 'سارة',
        recipient_en: 'Sara',
        recent: '2',
      },
    ]);
    expect(await loadAccountMailContext(fake.tx, PERSON, 'platform.password_reset')).toEqual({
      organizationName: { ar: 'شركة الراية', en: null },
      recipientName: { ar: 'سارة', en: 'Sara' },
      recentCount: 2,
    });
    expect(fake.executed[0]?.params).toEqual(['platform.password_reset', PERSON]);
    expect(await loadAccountMailContext(fakeTx([]).tx, PERSON, 'x.y')).toBeNull();
  });
});
