import type { SystemRoleCode } from './system-roles';

/**
 * Separation of duties (BR-IAM-4, PO decisions 7 and 8 Oct 2026, BRD v2.6; T-M2-16): the Organization
 * Admin is a setup-only role and holds no other role — one person never holds tenant_admin together with
 * any other role in the same organization. Other roles combine freely. The database enforces it on every
 * write (migration 20261010090000, private.roles_conflict — drift test in separation-of-duties.test.ts);
 * these helpers let actions refuse early with a clear message (ROLE_CONFLICT). The rule is per
 * organization: the same login may be the Organization Admin of one organization and hold other roles in
 * another.
 */
export const SOLE_ROLE_CODES: readonly SystemRoleCode[] = ['tenant_admin'];

const SOLE: ReadonlySet<string> = new Set(SOLE_ROLE_CODES);

/** May one person not hold these two roles at the same time? */
export function rolesConflict(a: string, b: string): boolean {
  return a !== b && (SOLE.has(a) || SOLE.has(b));
}

/** Do the roles (e.g. an invitation's primary + additional roles) include two that conflict? */
export function includesConflictingRoles(codes: readonly string[]): boolean {
  return codes.some((a) => codes.some((b) => rolesConflict(a, b)));
}

/** A role with its first and last day (YYYY-MM-DD, inclusive; null = open). */
export interface RoleDays {
  readonly roleCode: string;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
}

/**
 * Are two conflicting roles held on some day from `today` on (days in the organization's time zone)?
 * Same rule as the database (private.role_windows_overlap): an ended role is history, and a scheduled
 * hand-over (one role's last day before the other's first day) is allowed.
 */
export function rolesHeldTogether(roles: readonly RoleDays[], today: string): boolean {
  return roles.some((a) =>
    roles.some((b) => {
      if (!rolesConflict(a.roleCode, b.roleCode)) return false;
      const starts = [today, a.validFrom ?? today, b.validFrom ?? today].sort();
      const ends = [a.validUntil, b.validUntil].filter((d): d is string => d !== null).sort();
      const first = starts[starts.length - 1] ?? today;
      const last = ends[0];
      return last === undefined || first <= last;
    }),
  );
}
