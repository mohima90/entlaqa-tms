import 'server-only';
import { PlatformErrors } from '@jadarat/platform-core';
import { PasswordErrors } from '@jadarat/platform-identity';
import { MfaResetErrors } from '@jadarat/platform-rbac';
import { getTranslations } from 'next-intl/server';

/** Message keys My profile actions can return (platform + password registries). */
export const PROFILE_ERROR_KEYS: readonly string[] = [
  ...Object.values(PlatformErrors).map((def) => def.messageKey),
  ...Object.values(PasswordErrors).map((def) => def.messageKey),
];

/** Message keys of a member's sign-in and security actions on screen 3 (sessions, app reset; T-M2-10). */
export const MEMBER_SECURITY_ERROR_KEYS: readonly string[] = [
  ...Object.values(PlatformErrors).map((def) => def.messageKey),
  ...Object.values(MfaResetErrors).map((def) => def.messageKey),
];

async function rawTexts(locale: string, keys: readonly string[]): Promise<Record<string, string>> {
  const t = await getTranslations({ locale });
  return Object.fromEntries(keys.map((key) => [key, String(t.raw(key))]));
}

/** Raw (unformatted) error texts for the client forms; `{correlationId}` stays a placeholder. */
export async function profileErrorTexts(locale: string): Promise<Record<string, string>> {
  return rawTexts(locale, PROFILE_ERROR_KEYS);
}

/** Error texts for a member's sessions and authenticator reset (user profile, screen 3). */
export async function memberSecurityErrorTexts(locale: string): Promise<Record<string, string>> {
  return rawTexts(locale, MEMBER_SECURITY_ERROR_KEYS);
}
