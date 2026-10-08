/** Change-roles form helpers (T-M2-14) — shared by the page (server) and the form (client). */

export interface RoleChoice {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly privileged: boolean;
}

export interface RoleRow {
  readonly roleCode: string;
  readonly isPrimary: boolean;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
}

export interface RolesFormState {
  readonly primary: string;
  /** Additional roles by code, with their first and last days ('' = none). */
  readonly additional: Readonly<
    Record<string, { readonly validFrom: string; readonly validUntil: string }>
  >;
}

export function formStateFromRoles(roles: readonly RoleRow[]): RolesFormState {
  const additional: Record<string, { validFrom: string; validUntil: string }> = {};
  for (const r of roles) {
    if (!r.isPrimary)
      additional[r.roleCode] = { validFrom: r.validFrom ?? '', validUntil: r.validUntil ?? '' };
  }
  return { primary: roles.find((r) => r.isPrimary)?.roleCode ?? '', additional };
}

const orNull = (day: string | undefined): string | null =>
  day === undefined || day === '' ? null : day;

/**
 * The roles the form would save: the primary first, then the additional ones in catalogue order. A
 * primary role that stays primary keeps its days (the server does the same: keepPrimaryDays).
 */
export function desiredRoles(
  state: RolesFormState,
  catalogue: readonly RoleChoice[],
  stored: readonly RoleRow[] = [],
): RoleRow[] {
  // The role chosen as primary keeps its stored days (server: keepPrimaryDays).
  const storedPrimary = stored.find((r) => r.roleCode === state.primary);
  return [
    {
      roleCode: state.primary,
      isPrimary: true,
      validFrom: storedPrimary?.validFrom ?? null,
      validUntil: storedPrimary?.validUntil ?? null,
    },
    ...catalogue
      .filter((c) => c.code !== state.primary && state.additional[c.code] !== undefined)
      .map((c) => {
        const days = state.additional[c.code];
        return {
          roleCode: c.code,
          isPrimary: false,
          validFrom: orNull(days?.validFrom),
          validUntil: orNull(days?.validUntil),
        };
      }),
  ];
}

/** Same rule as the server (touchesPrivilegedRoles): which action the form calls. */
export function touchesPrivileged(
  before: readonly RoleRow[],
  after: readonly RoleRow[],
  privileged: ReadonlySet<string>,
): boolean {
  const key = (r: RoleRow) => `${String(r.isPrimary)}|${r.validFrom ?? ''}|${r.validUntil ?? ''}`;
  const was = new Map(before.map((r) => [r.roleCode, key(r)]));
  const will = new Map(after.map((r) => [r.roleCode, key(r)]));
  return [...new Set([...was.keys(), ...will.keys()])].some(
    (code) => privileged.has(code) && was.get(code) !== will.get(code),
  );
}

/** A role's state today (days in the organization's time zone; YYYY-MM-DD compares as text). */
export function roleTiming(
  validFrom: string | null,
  validUntil: string | null,
  today: string,
): 'ended' | 'scheduled' | 'current' {
  if (validUntil !== null && validUntil < today) return 'ended';
  if (validFrom !== null && validFrom > today) return 'scheduled';
  return 'current';
}

/**
 * Roles the member cannot change here: privileged ones unless allowed. Choosing another primary role is
 * impossible while the current primary is locked (that would remove it as primary).
 */
export function lockedRoles(
  catalogue: readonly RoleChoice[],
  privilegedAllowed: boolean,
): ReadonlySet<string> {
  return new Set(privilegedAllowed ? [] : catalogue.filter((c) => c.privileged).map((c) => c.code));
}

/** Do two roles conflict (BR-IAM-4)? A role held alone (`sole`, from SOLE_ROLE_CODES on the server)
 * conflicts with every other role. Same rule as the server (rolesConflict). */
export function soleConflict(a: string, b: string, sole: readonly string[]): boolean {
  return a !== b && (sole.includes(a) || sole.includes(b));
}

/**
 * Separation of duties (BR-IAM-4, T-M2-16; the Organization Admin holds no other role): may `code` be
 * chosen now — as the primary role or as an additional role — while a conflicting role is chosen and
 * not ended? A role already chosen can always be unchosen; choosing another primary role replaces the
 * current one (so the current primary never blocks the primary choice). Same rule as the server
 * (rolesHeldTogether), without dates for the new choice: the server decides about scheduled hand-overs.
 */
export function blockedBySole(
  code: string,
  as: 'primary' | 'additional',
  state: RolesFormState,
  sole: readonly string[],
  today: string,
): boolean {
  if (as === 'primary' ? state.primary === code : state.additional[code] !== undefined) {
    return false;
  }
  const held = Object.entries(state.additional)
    .filter(
      ([other, days]) => other !== code && (days.validUntil === '' || days.validUntil >= today),
    )
    .map(([other]) => other);
  if (as === 'additional' && state.primary !== '') held.push(state.primary);
  return held.some((other) => soleConflict(code, other, sole));
}
