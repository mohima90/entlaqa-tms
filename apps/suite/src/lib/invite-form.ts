/**
 * Invitations, admin side (T-M2-07, FR-IAM-03; screens 1 and 2) — client-safe helpers shared by the
 * pages (server) and the forms (client): roles offered, field errors, resend rule.
 */
/** First e-mail + 3 resends (invitations contract §1 step 3; MAX_INVITATION_SENDS on the server). */
export const MAX_SENDS = 4;
/** Days an invitation link stays valid. */
export const VALID_DAYS = 7;

/** The six roles screen 2 offers first; "show all roles" adds the rest. */
export const COMMON_ROLE_CODES: readonly string[] = [
  'tenant_admin',
  'training_manager',
  'training_coordinator',
  'hr_manager',
  'line_manager',
  'learner',
];

/** Search parameter of the users list that shows the "invitation created" confirmation. */
export const INVITED_FLASH_PARAM = 'invited';

export interface RoleChoice {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly privileged: boolean;
}

/** Roles offered: the common ones first (in screen order), then the others when `all` is on. */
export function rolesShown(catalogue: readonly RoleChoice[], all: boolean): readonly RoleChoice[] {
  const common = COMMON_ROLE_CODES.flatMap((code) => catalogue.filter((c) => c.code === code));
  if (!all) return common;
  return [...common, ...catalogue.filter((c) => !COMMON_ROLE_CODES.includes(c.code))];
}

/** Codes of the roles the member may not give in this session (privileged ones unless allowed). */
export function lockedRoleCodes(
  catalogue: readonly RoleChoice[],
  privilegedAllowed: boolean,
): ReadonlySet<string> {
  return new Set(privilegedAllowed ? [] : catalogue.filter((c) => c.privileged).map((c) => c.code));
}

/** Does the choice include a privileged role (→ the privileged action, strict session check)? */
export function choosesPrivileged(
  catalogue: readonly RoleChoice[],
  primary: string,
  additional: readonly string[],
): boolean {
  const privileged = new Set(catalogue.filter((c) => c.privileged).map((c) => c.code));
  return privileged.has(primary) || additional.some((code) => privileged.has(code));
}

/** Form field and text key for a field error of the invite action (codes only; never values). */
export function inviteFieldError(
  path: string,
  code: string,
): { readonly field: string; readonly key: string } {
  const field = path.split('.')[0] ?? path;
  switch (field) {
    case 'email':
      return { field, key: code === 'EMAIL_TAKEN' ? 'emailTaken' : 'email' };
    case 'firstNameAr':
    case 'familyNameAr':
      return { field, key: code === 'TOO_SMALL' ? 'required' : 'name' };
    case 'employeeNumber':
      return {
        field,
        key: code === 'EMPLOYEE_NUMBER_TAKEN' ? 'employeeNumberTaken' : 'employeeNumber',
      };
    case 'primaryRole':
      if (code === 'ROLE_CONFLICT') return { field, key: 'roleConflict' };
      return { field, key: code === 'ROLE_NOT_ALLOWED' ? 'roleNotAllowed' : 'roleRequired' };
    case 'additionalRoles':
      if (code === 'ROLE_CONFLICT') return { field, key: 'roleConflict' };
      return { field, key: code === 'ROLE_NOT_ALLOWED' ? 'roleNotAllowed' : 'roles' };
    case 'departmentId':
    case 'branchId':
      return { field, key: 'unit' };
    case 'managerPersonId':
      return { field, key: 'manager' };
    default:
      return { field, key: 'name' };
  }
}

export interface InvitationListItem {
  readonly id: string;
  readonly personId: string;
  readonly email: string;
  readonly displayNameAr: string;
  readonly displayNameEn: string | null;
  readonly primaryRole: string;
  /**
   * `held`: added by a bulk import with «لا تُرسل الدعوات الآن» (T-M2-12) — no e-mail yet; `scheduled`:
   * its e-mail goes out shortly (the import's pace).
   */
  readonly state: 'pending' | 'expired' | 'held' | 'scheduled' | 'accepted' | 'revoked';
  readonly sendCount: number;
}

/**
 * Resend is offered while pending (also after expiry) until the last of the 4 e-mails. A held invitation
 * is sent with «إرسال الدعوة» instead (T-M2-12); a scheduled one is on its way.
 */
export function canResend(row: Pick<InvitationListItem, 'state' | 'sendCount'>): boolean {
  return (row.state === 'pending' || row.state === 'expired') && row.sendCount < MAX_SENDS;
}

/**
 * Separation of duties (BR-IAM-4, T-M2-16; the Organization Admin holds no other role): is `code`
 * unavailable because a conflicting role is chosen? A role held alone (`sole`, from SOLE_ROLE_CODES on
 * the server) conflicts with every other role. Only roles not chosen yet are blocked; choosing another
 * primary role replaces the current one (so the current primary never blocks the primary choice). The
 * server refuses conflicting roles anyway (ROLE_CONFLICT).
 */
export function blockedBySole(
  code: string,
  as: 'primary' | 'additional',
  primary: string,
  additional: readonly string[],
  sole: readonly string[],
): boolean {
  if (as === 'primary' ? primary === code : additional.includes(code)) return false;
  const held = additional.filter((other) => other !== code);
  if (as === 'additional' && primary !== '') held.push(primary);
  return held.some((other) => other !== code && (sole.includes(code) || sole.includes(other)));
}

/**
 * The invitee's name as the page shows it: in English when the page is English and the English name was
 * given, else the Arabic name (review L4).
 */
export function createdName(
  uiLocale: 'ar' | 'en',
  names: { ar: readonly string[]; en: readonly string[] },
): string {
  const join = (parts: readonly string[]) =>
    parts
      .map((p) => p.trim())
      .filter((p) => p !== '')
      .join(' ');
  const en = join(names.en);
  return uiLocale === 'en' && en !== '' ? en : join(names.ar);
}
