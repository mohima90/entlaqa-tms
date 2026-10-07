import 'server-only';
import { RECOVERY_TOKEN_HASH_PATTERN } from '@jadarat/platform-identity';
import { z } from 'zod';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, utf8Length } from './password-rules';

/**
 * Inputs of the password-reset actions (apps/suite/src/auth/password-reset.ts; FR-IAM-13, T-M2-08).
 * Strict: unknown fields are refused. Field-error codes only (never values) reach the client.
 */

/** Screen 10. `locale` is the page language (the e-mail itself is bilingual, Arabic first). */
export const RequestPasswordResetInput = z.strictObject({
  email: z.email().max(254),
  locale: z.enum(['ar', 'en']),
});

/**
 * Screen 11. `tokenHash` is the link's token (read from the URL fragment in the browser). Same password
 * rules as My profile and the invitation (12+ characters — Auth's own minimum is 12 too — and at most
 * 72 bytes), checked BEFORE the single-use link is spent.
 */
export const CompletePasswordResetInput = z
  .strictObject({
    tokenHash: z.string().regex(RECOVERY_TOKEN_HASH_PATTERN),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH)
      .refine((v) => utf8Length(v) <= PASSWORD_MAX_BYTES, { message: 'too_long' }),
    confirmPassword: z.string().max(128),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'mismatch',
  });
