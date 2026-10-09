import { ADMIN_KEY_WARN_DAYS, adminKeyDaysLeft } from './config';

const DAY_MS = 86_400_000;

/**
 * The Auth admin token's expiry check (T-M2-17 security review): a self-hosted service_role token lives
 * 90 days (infra/docker/gen-secrets.sh). The returned function calls `warn` with the whole days left
 * (negative once expired) while fewer than 30 are left — on its first call (start-up) and then at most
 * once every 24 hours per process, however often it is called (the account-mail task runs every minute).
 * Only the days left ever leave this function, never the token; a key without an expiry (`sb_secret_…`)
 * never warns.
 */
export function adminKeyExpiryCheck(
  secretKey: string,
  warn: (daysLeft: number) => void,
  clock: () => number = Date.now,
): () => void {
  let lastCheck: number | undefined;
  return () => {
    const now = clock();
    if (lastCheck !== undefined && now - lastCheck < DAY_MS) return;
    lastCheck = now;
    const daysLeft = adminKeyDaysLeft(secretKey, now);
    if (daysLeft !== undefined && daysLeft < ADMIN_KEY_WARN_DAYS) warn(daysLeft);
  };
}
