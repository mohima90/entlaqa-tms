import 'server-only';
import { PlatformErrors } from '@jadarat/platform-core';
import { PasswordErrors } from '@jadarat/platform-identity';
import { getTranslations } from 'next-intl/server';

/** Message keys My profile actions can return (platform + password registries). */
export const PROFILE_ERROR_KEYS: readonly string[] = [
  ...Object.values(PlatformErrors).map((def) => def.messageKey),
  ...Object.values(PasswordErrors).map((def) => def.messageKey),
];

/** Raw (unformatted) error texts for the client forms; `{correlationId}` stays a placeholder. */
export async function profileErrorTexts(locale: string): Promise<Record<string, string>> {
  const t = await getTranslations({ locale });
  return Object.fromEntries(PROFILE_ERROR_KEYS.map((key) => [key, String(t.raw(key))]));
}
