/**
 * Invitations, admin side (T-M2-07, FR-IAM-03; screens 1 and 2) — client-safe helpers shared by the
 * pages (server) and the forms (client): field errors, resend rule (roles: lib/role-choice).
 */
/** First e-mail + 3 resends (invitations contract §1 step 3; MAX_INVITATION_SENDS on the server). */
export const MAX_SENDS = 4;
/** Days an invitation link stays valid. */
export const VALID_DAYS = 7;

/** Search parameter of the users list that shows the "invitation created" confirmation. */
export const INVITED_FLASH_PARAM = 'invited';

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
    case 'firstNameEn':
    case 'familyNameEn':
      // REQUIRED: the organization's default language's names (PO 17 Oct 2026).
      return { field, key: code === 'TOO_SMALL' || code === 'REQUIRED' ? 'required' : 'name' };
    case 'employeeNumber':
      return {
        field,
        key: code === 'EMPLOYEE_NUMBER_TAKEN' ? 'employeeNumberTaken' : 'employeeNumber',
      };
    case 'role':
      // One role per person (EP-ROLES): unknown (deleted meanwhile), not allowed, or missing.
      if (code === 'ROLE_UNKNOWN') return { field, key: 'roleUnknown' };
      return {
        field,
        key:
          code === 'ROLE_NOT_ALLOWED' || code === 'ROLE_CONFLICT'
            ? 'roleNotAllowed'
            : 'roleRequired',
      };
    case 'departmentId':
    case 'branchId':
      return { field, key: 'unit' };
    case 'scopeUnitId':
      // The unit of a department-limited custom role (EP-ORG, T-M3-09).
      return { field, key: code === 'UNIT_REQUIRED' ? 'unitRequired' : 'unitNotAllowed' };
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
  readonly displayNameAr: string | null;
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
 * The invitee's name as the page shows it: in the page's language when given, else in the other language
 * (review L4; either may be missing since PO 17 Oct 2026).
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
  const ar = join(names.ar);
  return uiLocale === 'en' ? en || ar : ar || en;
}
