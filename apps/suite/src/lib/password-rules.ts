/**
 * Password rules shown live while a password is chosen (invitation acceptance, screen 8; FR-IAM-13).
 * The same limits as the server schemas (ChangePasswordInput, lib/invite-accept-input.ts): at least 12
 * characters, at most 72 bytes in UTF-8 (bcrypt limit — an Arabic letter takes 2 bytes). Supabase Auth
 * applies its own policy on top (e.g. leaked passwords where available). Client-safe: no server imports.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

export interface PasswordRuleState {
  readonly minLength: boolean;
  readonly maxBytes: boolean;
  /** Both entries are filled in and equal. */
  readonly matches: boolean;
}

export function passwordRuleState(password: string, confirmation: string): PasswordRuleState {
  return {
    minLength: password.length >= PASSWORD_MIN_LENGTH,
    maxBytes: utf8Length(password) <= PASSWORD_MAX_BYTES,
    matches: password.length > 0 && password === confirmation,
  };
}
