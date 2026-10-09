'use server';
/**
 * Authenticator app (FR-IAM-12, T-M2-10): set up, code at sign-in or before a sensitive action, remove,
 * and "not now" on the Organization Admin prompt (PO decision 2). Public actions (ADR 0003 §4.7): a session
 * the organization's MFA policy refuses has no access to the organization until a code passed, so these
 * cannot be tenant actions. Each flow verifies the caller's own session with Auth (platform-identity mfa.ts)
 * and acts on that account only; the database applies the organization's policy.
 */
import { ok } from '@jadarat/platform-core';
import { normalizeDigits } from '@jadarat/platform-i18n';
import {
  dismissMfaPromptForRequest,
  removeTotpForRequest,
  startTotpSetupForRequest,
  verifyTotpCodeForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import { z } from 'zod';

/** Six digits, typed in any script and with spaces (as some apps show "123 456"). */
const TotpCode = z
  .string()
  .max(32)
  .transform((value) => normalizeDigits(value).replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/));

export const startTotpSetupAction = definePublicAction({
  name: 'platform.auth.mfa_setup',
  input: z.strictObject({}),
  handler: () => startTotpSetupForRequest(),
});

export const verifyTotpCodeAction = definePublicAction({
  name: 'platform.auth.mfa_verify',
  input: z.strictObject({ code: TotpCode, factorId: z.uuid().optional() }),
  handler: ({ input }) => verifyTotpCodeForRequest(input),
});

export const removeTotpAction = definePublicAction({
  name: 'platform.auth.mfa_remove',
  input: z.strictObject({}),
  handler: () => removeTotpForRequest(),
});

export const dismissMfaPromptAction = definePublicAction({
  name: 'platform.auth.mfa_prompt_dismiss',
  input: z.strictObject({}),
  handler: async () => ok(await dismissMfaPromptForRequest()),
});
