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
 * of a member of their organization from the user's profile. `platform.user.unlock_sign_in` (Organization
 * Admin only) for the person; the database checks the role and the organization again and never shows
 * the web app the member's address or a key (platform-db sign-in-lock.ts). Audited as
 * `platform.user.sign_in_unlocked`.
 */
const p = platformPermissions;

/** The account budget the lock is measured against: the one sign-in applies (per organization: T-M2-10). */
export type AccountLockBudget = () => number;

const defaultBudget: AccountLockBudget = () => limitsFor({}).signIn.accountFailures.max;

/**
 * For the profile page (inside its query): the member's lock state when the viewer may unlock it
 * (`canUnlock`: platform.user.unlock_sign_in for the person) and the person has an account here; null
 * otherwise (the page then shows nothing about it).
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

export interface UnlockSignInOutcome {
  /** There was a lock (or a run of failures) to end; false when it had lifted by itself meanwhile. */
  readonly unlocked: boolean;
}

export function unlockSignInActionDefinition(): ActionDefinition<
  typeof UnlockSignInInput,
  UnlockSignInOutcome,
  UserTx
> {
  return {
    permission: p['platform.user.unlock_sign_in'],
    input: UnlockSignInInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      if (!ctx.resource) return err(appError('NOT_FOUND'));
      return ok({ unlocked: await unlockMemberSignIn(ctx.tx, input.personId) });
    },
    // Only an actual unlock is a change worth an audit row.
    audit: (input, output) =>
      output.unlocked
        ? {
            action: 'platform.user.sign_in_unlocked',
            entityType: 'person',
            entityId: input.personId,
          }
        : null,
  };
}
