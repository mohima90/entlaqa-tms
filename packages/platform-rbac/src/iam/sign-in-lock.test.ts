import { ok } from '@jadarat/platform-core';
import type { UserTx } from '@jadarat/platform-db';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { grantsForAssignments } from '../role-grants';
import type { SystemRoleCode } from '../system-roles';
import { unlockSignInActionDefinition } from './sign-in-lock';

const db = vi.hoisted(() => ({ memberSignInLock: vi.fn(), unlockMemberSignIn: vi.fn() }));
vi.mock('@jadarat/platform-db', () => db);

const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const MEMBER = '44444444-4444-4444-8444-444444444444';
const TX = 'tx' as unknown as UserTx;

function runtime(roles: SystemRoleCode[]) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const rt: ActionRuntime<UserTx> = {
    getClaims: () => {
      const r = brandVerifiedClaims({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        aal: 'aal1',
        tenant_id: TENANT,
        person_id: ME,
      });
      if (!r.ok) throw new Error('fixture');
      return Promise.resolve(ok(r.value));
    },
    withUserTx: (_c, fn) => fn(TX),
    loadGrants: () =>
      Promise.resolve(
        grantsForAssignments(
          roles.map((roleCode) => ({ roleCode })),
          { headedDepartmentIds: [] },
        ),
      ),
    resolveResource: (_tx, ref) =>
      Promise.resolve(
        ref.id === MEMBER
          ? { type: 'person', id: MEMBER, tenantId: TENANT, subjectPersonId: MEMBER }
          : null,
      ),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.unlockMemberSignIn.mockResolvedValue('unlocked');
});

describe('unlock sign-in (T-M2-11, PO decision 9 Oct 2026)', () => {
  it('Organization Admin: ends the member’s lock in the action’s transaction, audited', async () => {
    const { rt, writeAudit } = runtime(['tenant_admin']);
    const result = await createDefineAction(rt)(unlockSignInActionDefinition())({
      personId: MEMBER,
    });
    expect(result).toEqual(ok({ outcome: 'unlocked' }));
    // Measured against the account budget sign-in applies (the platform's 5 by default).
    expect(db.unlockMemberSignIn).toHaveBeenCalledWith(TX, MEMBER, 5);
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.user.sign_in_unlocked',
      entityType: 'person',
      entityId: MEMBER,
    });
  });

  it('nothing to unlock (the lock lifted meanwhile), or 3 unlocks today already: answered, not audited', async () => {
    for (const outcome of ['not_locked', 'limited'] as const) {
      db.unlockMemberSignIn.mockResolvedValue(outcome);
      const { rt, writeAudit } = runtime(['tenant_admin']);
      const result = await createDefineAction(rt)(unlockSignInActionDefinition(() => 3))({
        personId: MEMBER,
      });
      expect(result).toEqual(ok({ outcome }));
      expect(db.unlockMemberSignIn).toHaveBeenLastCalledWith(TX, MEMBER, 3);
      expect(writeAudit).not.toHaveBeenCalled();
    }
  });

  it('a person without an active membership with an account here (revoked, suspended…): NOT_FOUND', async () => {
    db.unlockMemberSignIn.mockResolvedValue('no_account');
    const { rt, writeAudit } = runtime(['tenant_admin']);
    const result = await createDefineAction(rt)(unlockSignInActionDefinition())({
      personId: MEMBER,
    });
    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('nobody else: HR Manager and learner are refused; a person out of reach is not found', async () => {
    for (const role of ['hr_manager', 'learner'] as const) {
      const { rt } = runtime([role]);
      const result = await createDefineAction(rt)(unlockSignInActionDefinition())({
        personId: MEMBER,
      });
      expect(result.ok, role).toBe(false);
      expect(!result.ok && ['FORBIDDEN', 'NOT_FOUND'].includes(result.error.code), role).toBe(true);
    }
    const { rt } = runtime(['tenant_admin']);
    const elsewhere = await createDefineAction(rt)(unlockSignInActionDefinition())({
      personId: '55555555-5555-4555-8555-555555555555',
    });
    expect(!elsewhere.ok && elsewhere.error.code).toBe('NOT_FOUND');
    const invalid = await createDefineAction(rt)(unlockSignInActionDefinition())({
      personId: 'not-a-uuid',
    });
    expect(!invalid.ok && invalid.error.code).toBe('VALIDATION_FAILED');
    expect(db.unlockMemberSignIn).not.toHaveBeenCalled();
  });
});
