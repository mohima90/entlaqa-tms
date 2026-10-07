import 'server-only';
import { hasVisibleText } from '@jadarat/platform-i18n';
import { INVITATION_TOKEN_PATTERN } from '@jadarat/platform-identity';
import { z } from 'zod';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, utf8Length } from './password-rules';

/**
 * Inputs of the invitation actions (apps/suite/src/auth/invitations.ts; FR-IAM-03, T-M2-07). Strict:
 * unknown fields are refused. Field-error codes only (never values) reach the client.
 */

/** The e-mailed token: 32 random bytes, base64url, 43 characters (contract §1 step 2). */
const token = z.string().regex(INVITATION_TOKEN_PATTERN);

/**
 * Optional display name, as on My profile (≤ 200 characters in total). Left empty it keeps the name the
 * organization entered; otherwise it must contain visible text (not only spaces, joiners or direction
 * marks — the same check as the invite form and the database).
 */
const displayName = z
  .string()
  .trim()
  .max(200)
  .refine((value) => value === '' || hasVisibleText(value), { message: 'invisible' })
  .optional();

export const AcceptInvitationInput = z
  .strictObject({
    token,
    displayNameAr: displayName,
    displayNameEn: displayName,
    // Same rules as ChangePasswordInput (FR-IAM-13): 12+ characters, at most 72 bytes.
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH)
      .refine((v) => utf8Length(v) <= PASSWORD_MAX_BYTES, { message: 'too_long' }),
    confirmPassword: z.string().max(128),
    // The privacy notice must be acknowledged (screen 8).
    privacyAcknowledged: z.literal(true),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'mismatch',
  });

/** "Sign in to accept": the e-mail comes from the invitation, only the password from the form. */
export const SignInToAcceptInput = z.strictObject({
  token,
  // Length bound only, as for sign-in: Auth checks the password.
  password: z.string().min(1).max(1024),
});

export const AcceptAsSignedInInput = z.strictObject({ token });

/** The accept page asks what a link is (the token read from the URL fragment in the browser). */
export const LookupInvitationInput = z.strictObject({ token });
