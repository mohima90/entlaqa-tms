import 'server-only';
import { parseAppBaseUrl } from './app-base-url';
import { inviteLink } from './invite-link';

/**
 * The one server helper for the app's canonical public origin (FR-IAM-03, FR-ADM-17; security reviews L2):
 * APP_BASE_URL, else null — the browser then uses its own origin. Never derived from the request's Host.
 */
export function appBaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  return parseAppBaseUrl(env.APP_BASE_URL);
}

/** The invitation link to copy on the canonical origin, or null (the browser builds it on its own). */
export function canonicalInviteLink(locale: 'ar' | 'en', code: string): string | null {
  const base = appBaseUrl();
  return base === null ? null : inviteLink(base, locale, code);
}
