import 'server-only';
import { PlatformErrors } from '@jadarat/platform-core';
import { IdentityErrors } from '@jadarat/platform-identity';
import { getTranslations } from 'next-intl/server';

/** Message keys an auth action can return (platform + identity registries). */
export const AUTH_ERROR_KEYS: readonly string[] = [
  ...Object.values(PlatformErrors).map((def) => def.messageKey),
  ...Object.values(IdentityErrors).map((def) => def.messageKey),
];

/** Raw (unformatted) error texts for the client forms; `{correlationId}` stays a placeholder. */
export async function authErrorTexts(locale: string): Promise<Record<string, string>> {
  const t = await getTranslations({ locale });
  return Object.fromEntries(AUTH_ERROR_KEYS.map((key) => [key, String(t.raw(key))]));
}
