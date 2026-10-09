/**
 * Password rules shown live while a password is chosen (invitation acceptance, screen 8; reset, screen 11;
 * My profile; FR-IAM-13). The same limits as the server schemas (ChangePasswordInput,
 * lib/invite-accept-input.ts): at least 12 characters — or the organization's longer minimum (T-M2-10:
 * the strictest of the account's organizations, PO decision 5) — and at most 72 bytes in UTF-8 (bcrypt
 * limit — an Arabic letter takes 2 bytes). Supabase Auth applies its own policy on top (e.g. leaked
 * passwords where available). Client-safe: no server imports.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

/** Characters as people count them (code points): an Arabic letter or an emoji is one. */
export function characterCount(value: string): number {
  return Array.from(value).length;
}

export interface PasswordRuleState {
  /** The minimum length in force (12, or the organization's longer rule). */
  readonly min: number;
  readonly minLength: boolean;
  readonly maxBytes: boolean;
  /** Both entries are filled in and equal. */
  readonly matches: boolean;
}

export function passwordRuleState(
  password: string,
  confirmation: string,
  min: number = PASSWORD_MIN_LENGTH,
): PasswordRuleState {
  return {
    min,
    minLength: characterCount(password) >= min,
    maxBytes: utf8Length(password) <= PASSWORD_MAX_BYTES,
    matches: password.length > 0 && password === confirmation,
  };
}

/**
 * Fills `{min}` in a translated text: the pages translate with the placeholder kept (the length is known
 * only in the browser, e.g. after the invitation link was looked up).
 */
export function withMin(template: string, min: number): string {
  return template.replaceAll('{min}', String(min));
}

/** The minimum a refused password was measured against (the error's params), else the one shown. */
export function minFromParams(params: unknown, fallback: number): number {
  const min =
    typeof params === 'object' && params !== null && 'min' in params ? params.min : undefined;
  return typeof min === 'number' && Number.isInteger(min) ? min : fallback;
}
