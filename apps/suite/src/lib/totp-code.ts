import { normalizeDigits } from '@jadarat/platform-i18n';
import { z } from 'zod';

/**
 * A code from an authenticator app (FR-IAM-12, T-M2-10): six digits, typed in any script and with spaces
 * (as some apps show "123 456"). Used by the /mfa actions and the password reset of an account with an app.
 */
export const TotpCode = z
  .string()
  .max(32)
  .transform((value) => normalizeDigits(value).replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/));

/** Six digits in any script (spaces allowed) — the client's check before sending; the server checks again. */
export function looksLikeTotpCode(value: string): boolean {
  return /^[0-9٠-٩۰-۹]{6}$/.test(value.replace(/\s/g, ''));
}

/**
 * The one-time code of the authenticator set-up e-mail (re-review N1): eight digits, typed in any script and
 * with spaces (the e-mail shows "4071 8263"). Entered only in the window that set the app up.
 */
export const EmailSetupCode = z
  .string()
  .max(32)
  .transform((value) => normalizeDigits(value).replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{8}$/));

/** Eight digits in any script (spaces allowed) — the client's check before sending. */
export function looksLikeEmailSetupCode(value: string): boolean {
  return /^[0-9٠-٩۰-۹]{8}$/.test(value.replace(/\s/g, ''));
}
