/**
 * The pure parts of the account e-mail requests' detail (security digest, policy change, why an app was
 * removed), shared by the worker's lease (jobs/account-mail.ts) and the web app's immediate claim
 * (inline-account-mail.ts; WP-ADM-05 follow-up). Nothing here touches the database.
 */

/**
 * The security notices the database merges into an account's digest once its daily ceiling is reached
 * (final re-review L1).
 */
export const DIGESTED_KINDS = [
  'mfa_factor_added',
  'mfa_factor_removed',
  'security_policy_changed',
  'password_changed',
  'mfa_code_locked',
] as const;
export type DigestedKind = (typeof DIGESTED_KINDS)[number];

/** A security digest: how many notices of each kind were held, since when. */
export interface SecurityDigest {
  readonly held: Readonly<Partial<Record<DigestedKind, number>>>;
  readonly since: Date;
}

export function securityDigestOf(detail: unknown): SecurityDigest | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const { held, since } = detail as Record<string, unknown>;
  if (typeof held !== 'object' || held === null || typeof since !== 'string') return null;
  const counts: Partial<Record<DigestedKind, number>> = {};
  for (const [kind, count] of Object.entries(held as Record<string, unknown>)) {
    const known = DIGESTED_KINDS.find((k) => k === kind);
    if (!known || typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null;
    counts[known] = count;
  }
  const at = new Date(since);
  if (Object.keys(counts).length === 0 || Number.isNaN(at.getTime())) return null;
  return { held: counts, since: at };
}

/** Why an authenticator app was removed (the removal notice says so). */
export const MFA_REMOVAL_REASONS = [
  'removed',
  'not_me',
  'admin_reset',
  'support_reset',
  'expired',
  'too_many_codes',
] as const;
export type MfaRemovalReason = (typeof MFA_REMOVAL_REASONS)[number];

/** What a policy-change notice says (T-IAM-24): setting names, the editor's person, when. */
export interface PolicyChange {
  readonly changed: readonly string[];
  readonly changedByPersonId: string | null;
  readonly changedAt: Date;
}

const SETTING_NAME = /^[a-zA-Z]{2,40}$/;

export function policyChangeOf(detail: unknown): PolicyChange | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const { changed, changed_by: by, changed_at: at } = detail as Record<string, unknown>;
  if (!Array.isArray(changed) || changed.length === 0) return null;
  const names = changed.filter((n): n is string => typeof n === 'string' && SETTING_NAME.test(n));
  if (names.length !== changed.length || typeof at !== 'string') return null;
  return {
    changed: names,
    changedByPersonId: typeof by === 'string' ? by : null,
    changedAt: new Date(at),
  };
}
