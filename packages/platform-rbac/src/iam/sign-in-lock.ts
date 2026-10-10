import { appError, err, ok } from '@jadarat/platform-core';
import {
  type MemberSignInLock,
  type UserTx,
  memberSignInLock,
  unlockMemberSignIn,
} from '@jadarat/platform-db';
import { limitsFor } from '@jadarat/platform-identity';
import { z } from 'zod';
import type { ActionDefinition } from '../define-action';
import { platformPermissions } from '../platform-permissions';

/**
 * "Unlock sign-in" (PO decision 9 Oct 2026; T-M2-11, FR-IAM-13): after repeated failed attempts an
 * account is locked for 15 minutes for browsers it does not trust; the Organization Admin can end the lock
 * of an ACTIVE member of their organization from the user's profile. `platform.user.unlock_sign_in`
 * (Organization Admin only — not HR) for the person; the database checks the role, the organization and
 * the membership again and never shows the web app the member's address or a key (platform-db
 * sign-in-lock.ts). At most 3 unlocks per account a day (shared limiter); every unlock e-mails the account's
 * owner (security review M1). Audited as `platform.user.sign_in_unlocked`.
 */
const p = platformPermissions;

/** The account budget the lock is measured against: the one sign-in applies (per organization: T-M2-10). */
export type AccountLockBudget = () => number;

const defaultBudget: AccountLockBudget = () => limitsFor({}).signIn.accountFailures.max;

/**
 * For the profile page (inside its query): the member's lock state when the viewer may unlock it
 * (`canUnlock`: platform.user.unlock_sign_in for the person) and the person has an account with an ACTIVE
 * membership here (`hasAccount` — security review M1: a revoked, suspended or invited member is not the
 * organization's to unlock); null otherwise (the page then shows nothing about it).
 */
export async function signInLockForProfile(
  tx: UserTx,
  personId: string,
  options: { readonly canUnlock: boolean; readonly hasAccount: boolean },
  budget: AccountLockBudget = defaultBudget,
): Promise<MemberSignInLock | null> {
  if (!options.hasAccount || !options.canUnlock) return null;
  return memberSignInLock(tx, personId, budget());
}

export const UnlockSignInInput = z.object({ personId: z.uuid() });

export interface UnlockSignInResult {
  /**
   * `unlocked`: the lock ended (audited; the owner is e-mailed). `not_locked`: it had lifted by itself
   * meanwhile — nothing changed. `limited`: the account was unlocked 3 times within 24 hours already —
   * the lock stays (the person can still set a new password with «نسيت كلمة المرور؟»).
   */
  readonly outcome: 'unlocked' | 'not_locked' | 'limited';
}

/**
 * `budget`: the account budget the lock is measured against (the one sign-in applies — the same as the
 * profile's lock state). A person without an active membership with an account here is NOT_FOUND.
 */
export function unlockSignInActionDefinition(
  budget: AccountLockBudget = defaultBudget,
): ActionDefinition<typeof UnlockSignInInput, UnlockSignInResult, UserTx> {
  return {
    permission: p['platform.user.unlock_sign_in'],
    input: UnlockSignInInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      if (!ctx.resource) return err(appError('NOT_FOUND'));
      const outcome = await unlockMemberSignIn(ctx.tx, input.personId, budget());
      if (outcome === 'no_account') return err(appError('NOT_FOUND'));
      return ok({ outcome });
    },
    // Only an actual unlock is a change worth an audit row.
    audit: (input, output) =>
      output.outcome === 'unlocked'
        ? {
            action: 'platform.user.sign_in_unlocked',
            entityType: 'person',
            entityId: input.personId,
          }
        : null,
  };
}
