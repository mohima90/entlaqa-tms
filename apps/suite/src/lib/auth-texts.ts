import 'server-only';
import { PlatformErrors } from '@jadarat/platform-core';
import { IdentityErrors, InvitationErrors, PasswordResetErrors } from '@jadarat/platform-identity';
import { getTranslations } from 'next-intl/server';

/** Message keys an auth action can return (platform + identity registries). */
export const AUTH_ERROR_KEYS: readonly string[] = [
  ...Object.values(PlatformErrors).map((def) => def.messageKey),
  ...Object.values(IdentityErrors).map((def) => def.messageKey),
];

/** Message keys the invitation actions can return (auth keys + invitation registry). */
export const INVITE_ERROR_KEYS: readonly string[] = [
  ...AUTH_ERROR_KEYS,
  ...Object.values(InvitationErrors).map((def) => def.messageKey),
];

/** Message keys the password-reset actions can return (auth keys + reset registry). */
export const PASSWORD_RESET_ERROR_KEYS: readonly string[] = [
  ...AUTH_ERROR_KEYS,
  ...Object.values(PasswordResetErrors).map((def) => def.messageKey),
];

async function rawTexts(locale: string, keys: readonly string[]): Promise<Record<string, string>> {
  const t = await getTranslations({ locale });
  return Object.fromEntries(keys.map((key) => [key, String(t.raw(key))]));
}

/** Raw (unformatted) error texts for the client forms; `{correlationId}` stays a placeholder. */
export async function authErrorTexts(locale: string): Promise<Record<string, string>> {
  return rawTexts(locale, AUTH_ERROR_KEYS);
}

/** Error texts for the invitation forms (accept page). */
export async function inviteErrorTexts(locale: string): Promise<Record<string, string>> {
  return rawTexts(locale, INVITE_ERROR_KEYS);
}

/** Error texts for the forgot / reset password pages (screens 10 and 11). */
export async function passwordResetErrorTexts(locale: string): Promise<Record<string, string>> {
  return rawTexts(locale, PASSWORD_RESET_ERROR_KEYS);
}
