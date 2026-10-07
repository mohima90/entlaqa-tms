import type { SystemRoleCode } from './system-roles';

/**
 * Separation of duties (BR-IAM-4, PO decision 7 Oct 2026; T-M2-16): one person never holds both roles
 * of a pair in the same organization — today the Organization Admin (a setup role) and the HR Manager.
 * The database enforces it on every write (migration 20261010090000, private.exclusive_role — drift
 * test in separation-of-duties.test.ts); these helpers let actions refuse early with a clear message
 * (ROLE_CONFLICT). The rule is per organization: the same login may be the Organization Admin of one
 * organization and the HR Manager of another.
 */
export const EXCLUSIVE_ROLE_PAIRS: readonly (readonly [SystemRoleCode, SystemRoleCode])[] = [
  ['tenant_admin', 'hr_manager'],
];

/** Each role of a pair → the other one (for forms: which option a choice blocks). */
export const EXCLUSIVE_ROLES_BY_CODE: Readonly<Record<string, SystemRoleCode>> = Object.fromEntries(
  EXCLUSIVE_ROLE_PAIRS.flatMap(([a, b]) => [
    [a, b],
    [b, a],
  ]),
);

/** The role that may not be held together with `code`, or null. */
export function exclusiveRoleOf(code: string): SystemRoleCode | null {
  return Object.hasOwn(EXCLUSIVE_ROLES_BY_CODE, code)
    ? (EXCLUSIVE_ROLES_BY_CODE[code] ?? null)
    : null;
}

/** Do the roles (e.g. an invitation's primary + additional roles) include both roles of a pair? */
export function includesExclusivePair(codes: readonly string[]): boolean {
  return codes.some((code) => {
    const other = exclusiveRoleOf(code);
    return other !== null && codes.includes(other);
  });
}

/** A role with its first and last day (YYYY-MM-DD, inclusive; null = open). */
export interface RoleDays {
  readonly roleCode: string;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
}

/**
 * Are both roles of a pair held on some day from `today` on (days in the organization's time zone)?
 * Same rule as the database (private.role_windows_overlap): an ended role is history, and a scheduled
 * hand-over (one role's last day before the other's first day) is allowed.
 */
export function rolesHeldTogether(roles: readonly RoleDays[], today: string): boolean {
  return roles.some((a) => {
    const other = exclusiveRoleOf(a.roleCode);
    if (other === null) return false;
    return roles.some((b) => {
      if (b.roleCode !== other) return false;
      const starts = [today, a.validFrom ?? today, b.validFrom ?? today].sort();
      const ends = [a.validUntil, b.validUntil].filter((d): d is string => d !== null).sort();
      const first = starts[starts.length - 1] ?? today;
      const last = ends[0];
      return last === undefined || first <= last;
    });
  });
}
