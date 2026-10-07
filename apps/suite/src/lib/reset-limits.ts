import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { UNKNOWN_CLIENT, clientRateKey } from './client-ip';

/**
 * Application rate limits of the password reset (FR-IAM-13, T-M2-08; TM-0003 T-IAM-01/03, in front of
 * Supabase Auth — whose own per-IP limits see the app server's address, not the visitor's). In memory,
 * per app instance, 15-minute windows per key: a first line of defence until the shared PostgreSQL
 * limiter of ADR 0011 §4 exists (planned with the sign-in limiter, TM-0003 T-IAM-01).
 *  - reset e-mails: per CLIENT first, then — only for an allowed client — per ACCOUNT (an HMAC of the
 *    lower-cased address under a random key of this process; never the address itself). A refused
 *    request gets the same answer as any other (no enumeration) and Auth is not asked;
 *  - new-password submissions: per client (a refused one answers RATE_LIMITED; the link stays usable).
 * Clients are keyed by their address, IPv6 by its /64 (one subscriber's prefix). Without a trusted client
 * address (lib/client-ip.ts; self-hosted: JADARAT_CLIENT_IP_HEADER) every client shares one budget.
 * The tables never refuse a key because they are full: expired entries, then the oldest, make room
 * (security review M, 7 Oct 2026 — a full table must not lock everyone out).
 */
export const RESET_LIMIT_WINDOW_MS = 15 * 60_000;
export const RESET_LIMITS = {
  requestsPerAccount: 3,
  requestsPerClient: 10,
  completionsPerClient: 5,
  /** Shared by every client when no trusted client address is available (per instance). */
  unknownClients: 100,
} as const;
/** Keys kept per table (each entry is a few dozen bytes). */
export const RESET_LIMIT_MAX_KEYS = 10_000;

/**
 * A counter per key in fixed windows that start at the key's first attempt. When the table is full,
 * expired entries go first, then the oldest one (insertion order = window start order, since a renewed
 * window is re-inserted) — so a flood of new keys can make old counters restart, never lock anyone out.
 */
export function createEvictingLimiter(
  limit: number,
  windowMs: number,
  maxKeys: number,
  now: () => number = Date.now,
): (key: string) => boolean {
  const entries = new Map<string, { count: number; readonly start: number }>();
  const makeRoom = (time: number) => {
    for (const [key, entry] of entries) {
      if (time - entry.start < windowMs) break;
      entries.delete(key);
    }
    if (entries.size >= maxKeys) {
      const oldest = entries.keys().next();
      if (!oldest.done) entries.delete(oldest.value);
    }
  };
  return (key) => {
    const time = now();
    const entry = entries.get(key);
    if (entry && time - entry.start < windowMs) {
      if (entry.count >= limit) return false;
      entry.count += 1;
      return true;
    }
    if (entry) entries.delete(key);
    if (entries.size >= maxKeys) makeRoom(time);
    entries.set(key, { count: 1, start: time });
    return true;
  };
}

export interface ResetLimiter {
  /** Whether a reset e-mail may be requested for this address from this client (counts the attempt). */
  allowRequest(email: string, client: string): boolean;
  /** Whether this client may submit a new password now (counts the attempt). */
  allowCompletion(client: string): boolean;
}

export function createResetLimiter(
  now: () => number = Date.now,
  maxKeys: number = RESET_LIMIT_MAX_KEYS,
): ResetLimiter {
  // A new random key per process: account keys cannot be computed from addresses outside it.
  const hmacKey = randomBytes(32);
  const accountKey = (email: string) =>
    createHmac('sha256', hmacKey).update(email.trim().toLowerCase()).digest('base64url');
  const keyed = (limit: number) =>
    createEvictingLimiter(limit, RESET_LIMIT_WINDOW_MS, maxKeys, now);
  const perAccount = keyed(RESET_LIMITS.requestsPerAccount);
  const requestsPerClient = keyed(RESET_LIMITS.requestsPerClient);
  const requestsUnknown = keyed(RESET_LIMITS.unknownClients);
  const completionsPerClient = keyed(RESET_LIMITS.completionsPerClient);
  const completionsUnknown = keyed(RESET_LIMITS.unknownClients);
  return {
    allowRequest(email, client) {
      const clientAllowed =
        client === UNKNOWN_CLIENT
          ? requestsUnknown(UNKNOWN_CLIENT)
          : requestsPerClient(clientRateKey(client));
      // The account is counted only for an allowed client: a refused client cannot use up (or fill up)
      // the account budgets of others.
      return clientAllowed && perAccount(accountKey(email));
    },
    allowCompletion(client) {
      return client === UNKNOWN_CLIENT
        ? completionsUnknown(UNKNOWN_CLIENT)
        : completionsPerClient(clientRateKey(client));
    },
  };
}

/** The limiter of this app instance. */
export const resetLimiter: ResetLimiter = createResetLimiter();
