/**
 * How recent the authenticator code must be for a high-risk action (PO answer, 9 Oct 2026; security review
 * L3; TM-0003 T-IAM-41): the session passed a code within the last 15 minutes. defineAction (platform-rbac)
 * refuses older codes with STEP_UP_REQUIRED and the /mfa page asks again. The database checks the same rule
 * for the policy update and the member reset (private.step_up_max_age(), from the `code_at` claim withUserTx
 * derives; a drift check in step-up.test.ts keeps both equal).
 */
export const STEP_UP_MAX_AGE_SECONDS = 15 * 60;

/**
 * When the session last passed an authenticator code: the newest `totp` entry of the access token's `amr`
 * claim (Supabase Auth: `{ method, timestamp }`, seconds since the epoch). Null without one.
 */
export function codeVerifiedAt(claims: object): Date | null {
  const amr: unknown = 'amr' in claims ? claims.amr : undefined;
  if (!Array.isArray(amr)) return null;
  let newest: number | null = null;
  for (const entry of amr as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (method !== 'totp' || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue;
    if (newest === null || timestamp > newest) newest = timestamp;
  }
  return newest === null ? null : new Date(newest * 1000);
}

/** Was the session's last authenticator code recent enough for a high-risk action? */
export function codeIsFresh(
  claims: object,
  now: Date = new Date(),
  maxAgeSeconds: number = STEP_UP_MAX_AGE_SECONDS,
): boolean {
  const at = codeVerifiedAt(claims);
  if (at === null) return false;
  // A code a few seconds "in the future" (clock skew) counts as now.
  return (now.getTime() - at.getTime()) / 1000 <= maxAgeSeconds;
}
