'use server';
/**
 * Unauthenticated / pre-tenant server actions (ADR 0003 §2, T-M1-D03). The ONLY place where
 * definePublicAction() is allowed (CI gate, scripts/lib/server-actions.mjs): every entry point that
 * runs before the caller has an organization lives here. The flow logic and its checks are in
 * @jadarat/platform-identity (auth-flow.ts); these actions only validate input.
 */
import {
  selectOrganizationForRequest,
  signInWithPasswordForRequest,
  signOutForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import { z } from 'zod';

export const signInAction = definePublicAction({
  name: 'platform.auth.sign_in',
  input: z.object({
    email: z.email().max(254),
    // Length bound only: the password policy is enforced by Supabase Auth when passwords are set.
    password: z.string().min(1).max(1024),
  }),
  handler: ({ input }) => signInWithPasswordForRequest(input),
});

export const selectOrganizationAction = definePublicAction({
  name: 'platform.auth.select_organization',
  input: z.object({ tenantId: z.uuid() }),
  handler: ({ input }) => selectOrganizationForRequest(input.tenantId),
});

export const signOutAction = definePublicAction({
  name: 'platform.auth.sign_out',
  input: z.object({}).strict(),
  handler: () => signOutForRequest(),
});
