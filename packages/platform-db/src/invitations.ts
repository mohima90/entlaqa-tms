import 'server-only';
import { createHash } from 'node:crypto';
import { type SQL, sql } from 'drizzle-orm';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import { customRolesExist, storableArabicDisplayName } from './custom-roles-present';
import { DomainError } from './domain-error';
import { emitEvent } from './events';
import { pgError } from './user-admin';

/**
 * Invitations (FR-IAM-03, T-M2-07; docs/engineering/invitations-contract.md §2, migrations
 * 20261009090000 and 20261018090000 — invitation codes, Kawadir). Request-path helpers: inviting, listing,
 * revoking and resending run inside the signed-in user's withUserTx (the database guard checks the actor:
 * Organization Admin or HR Manager, privileged roles by an Organization Admin only); every invitation that
 * was sent has a 12-character CODE (invitation-code.ts) issued by the database
 * (private.issue_invitation_code: when inviting, and a new one on resend) that the members who may manage
 * it read one at a time (private.invitation_codes, `invitationCode`) to copy the code or the link — an
 * audited action (security review M2); the list only says whether a code exists. Looking a link up runs on
 * a plain app_server
 * connection WITHOUT claims (the visitor may have no session) through the reviewed SECURITY DEFINER
 * function private.invitation_by_token; accepting runs in the invitee's own withUserTx (the account just
 * created through the hook-gated sign-up, or an existing one) through private.accept_invitation_as_caller.
 * Audit events are the calling action's job (defineAction): these helpers emit the domain events only.
 */

export const INVITATION_EVENTS = {
  created: 'com.entlaqa.platform.invitation.created',
  resendRequested: 'com.entlaqa.platform.invitation.resend_requested',
  revoked: 'com.entlaqa.platform.invitation.revoked',
  accepted: 'com.entlaqa.platform.invitation.accepted',
} as const;

/** At most this many codes per invitation: the first one and 3 resends (new codes). */
export const INVITATION_MAX_SENDS = 4;

export {
  INVITATION_CODE_ALPHABET,
  INVITATION_CODE_LENGTH,
  INVITATION_CODE_PATTERN,
  INVITATION_SECRET_PATTERN,
  LEGACY_INVITATION_TOKEN_PATTERN,
  formatInvitationCode,
  normalizeInvitationCode,
} from './invitation-code';

/** Codes of the DomainErrors thrown by the invitation helpers. */
export type InvitationErrorCode =
  | 'EMAIL_TAKEN'
  | 'EMPLOYEE_NUMBER_TAKEN'
  | 'ROLE_NOT_ALLOWED'
  /** BR-IAM-4: the invitation would give the Organization Admin role together with another role. */
  | 'ROLE_CONFLICT'
  /**
   * The unit given with the role (EP-ORG, T-M3-09): the role is not limited to a department, or the unit is
   * not a live, active unit of the organization.
   */
  | 'UNIT_NOT_ALLOWED'
  | 'INVITATION_NOT_VALID'
  | 'INVITATION_ACCOUNT_MISMATCH'
  | 'ALREADY_MEMBER';

/**
 * `held`: added by a user import without sending («لم تُرسل الدعوة», T-M2-12) — no link yet; `scheduled`:
 * held and due to be sent shortly; `expired`: pending past its expiry.
 */
export type InvitationState = 'pending' | 'expired' | 'held' | 'scheduled' | 'accepted' | 'revoked';

export interface NewInvitation {
  /** Lowercase work e-mail (trimmed and lower-cased again here). */
  readonly email: string;
  /**
   * The names: the organization's default language's first and family names are required (checked by the
   * action, PO 17 Oct 2026); the database keeps every person named (persons_name_present_check).
   */
  readonly firstNameAr?: string | null;
  readonly familyNameAr?: string | null;
  readonly firstNameEn?: string | null;
  readonly familyNameEn?: string | null;
  readonly departmentId?: string | null;
  readonly branchId?: string | null;
  readonly managerPersonId?: string | null;
  readonly employeeNumber?: string | null;
  /** The role it gives: a standard role or a custom role of the organization (EP-ROLES). */
  readonly primaryRole: string;
  /** Always empty since EP-ROLES (one role per person; the database refuses others). */
  readonly additionalRoles: readonly string[];
  readonly locale: 'ar' | 'en';
  /** The unit of a custom role limited to «A department» (EP-ORG, T-M3-09); null for every other role. */
  readonly scopeUnitId?: string | null;
}

export interface InvitationRow {
  readonly id: string;
  readonly personId: string;
  readonly email: string;
  readonly displayNameAr: string | null;
  readonly displayNameEn: string | null;
  readonly primaryRole: string;
  /** The names of a custom role (EP-ROLES); null for a standard role. */
  readonly primaryRoleName: { readonly ar: string; readonly en: string } | null;
  /** It gives a privileged role (standard, or custom with a high-risk permission: computed now). */
  readonly privileged: boolean;
  readonly state: InvitationState;
  readonly sendCount: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  /** The user import that added the person (T-M2-12), or null when invited by hand. */
  readonly importId: string | null;
  /** The additional roles it gives (with `primaryRole`: whether a privileged role is among them). */
  readonly additionalRoles: readonly string[];
  /**
   * The invitation has a code the caller may copy now (Kawadir: copy code / copy link): pending,
   * unexpired, sent, and the caller may manage it. False e.g. for an HR Manager on an invitation with a
   * privileged role, a held import invitation, a link e-mailed before codes. The code itself is never in
   * the list: it is read one at a time when a member copies it (`invitationCode`, audited — security
   * review M2).
   */
  readonly hasCode: boolean;
  /** The invitation's language: the link opens the sign-up page in it. */
  readonly locale: 'ar' | 'en';
}

export type TokenLookup =
  | {
      readonly state: 'valid';
      readonly email: string;
      readonly locale: 'ar' | 'en';
      readonly organizationName: { ar: string; en: string | null };
      readonly displayName: { ar: string | null; en: string | null };
    }
  | { readonly state: 'expired' | 'revoked' | 'used' | 'invalid' };

/**
 * SHA-256 of the code's (or a legacy token's) UTF-8 bytes: the form the link lookups and acceptance send
 * to the database (token_hash = sha256(invite_code), migration 20261018090000).
 */
export function hashInvitationToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

function joinNames(...parts: (string | null | undefined)[]): string | null {
  const joined = parts
    .map((p) => p?.trim() ?? '')
    .filter((p) => p !== '')
    .join(' ');
  return joined === '' ? null : joined;
}

function textArray(values: readonly string[]): SQL {
  return values.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )}]::text[]`;
}

/** Maps the database refusals of an invitation write to DomainErrors; anything else is rethrown. */
export function invitationErrorOf(error: unknown): unknown {
  const pg = pgError(error);
  if (pg?.code === '23505') {
    if (
      pg.constraint === 'persons_tenant_email_uq' ||
      pg.constraint === 'invitations_pending_email_uq'
    ) {
      return new DomainError<InvitationErrorCode>('EMAIL_TAKEN', { cause: error });
    }
    if (pg.constraint === 'persons_tenant_employee_number_uq') {
      return new DomainError<InvitationErrorCode>('EMPLOYEE_NUMBER_TAKEN', { cause: error });
    }
  }
  if (pg?.code === '42501')
    return new DomainError<InvitationErrorCode>('ROLE_NOT_ALLOWED', { cause: error });
  // The unit given with the role (20261020090400).
  if (
    (pg?.code === '23514' &&
      (pg.message.includes('takes a unit') || pg.message.includes('active unit'))) ||
    (pg?.code === '23503' && pg.constraint === 'invitations_scope_unit_fkey')
  )
    return new DomainError<InvitationErrorCode>('UNIT_NOT_ALLOWED', { cause: error });
  // A role that does not exist (any more): e.g. a custom role deleted while the form was open (EP-ROLES).
  if (pg?.code === '23503' && pg.message.startsWith('unknown role'))
    return new DomainError<InvitationErrorCode>('ROLE_NOT_ALLOWED', { cause: error });
  // An invitation code collided with another a few times in a row (32^12 codes: practically never).
  if (pg?.code === '23505' && pg.constraint === 'invitations_invite_code_uq') return error;
  // Separation of duties (BR-IAM-4, migration 20261010090000).
  if (pg?.code === 'JR001')
    return new DomainError<InvitationErrorCode>('ROLE_CONFLICT', { cause: error });
  return error;
}

/**
 * Creates the person (with their placement), the pending invitation with its first code (issued by the
 * database: private.issue_invitation_code, valid 7 days) and the `invitation.created` event (the mailer
 * e-mails that code when e-mail is on), in the caller's transaction. Returns the code for the inviter to
 * copy (never logged or audited). A refusal leaves the transaction aborted (the action rolls back).
 * Throws DomainError EMAIL_TAKEN, EMPLOYEE_NUMBER_TAKEN, ROLE_NOT_ALLOWED (the actor may not invite, or not
 * with these roles) or ROLE_CONFLICT (the roles may not go together, BR-IAM-4).
 */
export async function createInvitation(
  tx: ClaimsTx,
  input: NewInvitation,
): Promise<{ invitationId: string; personId: string; inviteCode: string }> {
  const email = input.email.trim().toLowerCase();
  const firstNameAr = blankToNull(input.firstNameAr);
  const familyNameAr = blankToNull(input.familyNameAr);
  const firstNameEn = blankToNull(input.firstNameEn);
  const familyNameEn = blankToNull(input.familyNameEn);
  const employeeNumber = blankToNull(input.employeeNumber);
  const displayNameEn = joinNames(firstNameEn, familyNameEn);
  try {
    // No Arabic display name without Arabic names — before migration 20261021090000 the English one
    // (storableArabicDisplayName: the app may run minutes before the database changes).
    const displayNameAr = await storableArabicDisplayName(
      tx,
      joinNames(firstNameAr, familyNameAr),
      displayNameEn,
    );
    const [person] = await tx.execute<{ id: string }>(sql`
      insert into platform.persons
        (display_name_ar, display_name_en, first_name_ar, family_name_ar, first_name_en, family_name_en,
         email, employee_number, preferred_locale)
      values (${displayNameAr}, ${displayNameEn},
              ${firstNameAr}, ${familyNameAr}, ${firstNameEn}, ${familyNameEn},
              ${email}, ${employeeNumber}, ${input.locale})
      returning id`);
    if (!person) throw new Error('createInvitation: no person returned');
    await tx.execute(sql`
      insert into platform.person_employment (person_id, department_id, branch_id, manager_person_id)
      values (${person.id}::uuid, ${input.departmentId ?? null}::uuid, ${input.branchId ?? null}::uuid,
              ${input.managerPersonId ?? null}::uuid)`);
    const scopeUnitId = input.scopeUnitId ?? null;
    // The unit column only when there is a unit (an older database has none: expand-first, EP-ORG).
    const [invitation] = await tx.execute<{ id: string }>(
      scopeUnitId === null
        ? sql`
      insert into platform.invitations (person_id, email, locale, primary_role, additional_roles)
      values (${person.id}::uuid, ${email}, ${input.locale}, ${input.primaryRole},
              ${textArray(input.additionalRoles)})
      returning id`
        : sql`
      insert into platform.invitations (person_id, email, locale, primary_role, additional_roles, scope_unit_id)
      values (${person.id}::uuid, ${email}, ${input.locale}, ${input.primaryRole},
              ${textArray(input.additionalRoles)}, ${scopeUnitId}::uuid)
      returning id`,
    );
    if (!invitation) throw new Error('createInvitation: no invitation returned');
    const [issued] = await tx.execute<{ code: string }>(sql`
      select private.issue_invitation_code(${invitation.id}::uuid) as code`);
    if (!issued?.code) throw new Error('createInvitation: no code issued');
    await emitEvent(tx, { type: INVITATION_EVENTS.created, subject: invitation.id });
    return { invitationId: invitation.id, personId: person.id, inviteCode: issued.code };
  } catch (error) {
    throw invitationErrorOf(error);
  }
}

/**
 * The SQL expression of an invitation's state: held (not sent: no link, no expiry yet) and scheduled
 * first, then pending past its expiry reads as expired.
 */
const STATE = sql`case when i.status = 'pending' and i.mail_held and i.send_at is null then 'held'
                       when i.status = 'pending' and i.mail_held then 'scheduled'
                       when i.status = 'pending' and i.expires_at <= now() then 'expired'
                       when i.status = 'pending' then 'pending' else i.status end`;

/**
 * The organization's invitations, newest first, optionally of one state. Only user managers see any
 * (the read policy); `expired` = pending past its expiry.
 */
export async function listInvitations(
  tx: ClaimsTx,
  filter: { state?: InvitationState } = {},
): Promise<InvitationRow[]> {
  // Custom-role names once their table exists (deploy window, EP-ROLES).
  const customNames = await customRolesExist(tx);
  const rows = await tx.execute<{
    id: string;
    person_id: string;
    email: string;
    display_name_ar: string | null;
    display_name_en: string | null;
    primary_role: string;
    state: InvitationState;
    send_count: number;
    expires_at: Date | string;
    created_at: Date | string;
    import_id: string | null;
    has_code: boolean;
    locale: string;
    additional_roles: string[] | null;
    role_name_ar: string | null;
    role_name_en: string | null;
    privileged: boolean;
  }>(sql`
    select i.id, i.person_id, i.email, p.display_name_ar, p.display_name_en, i.primary_role,
           ${STATE} as state, i.send_count, i.expires_at, i.created_at, i.import_id,
           c.invitation_id is not null as has_code, i.locale, i.additional_roles,
           ${customNames ? sql`cr.name_ar` : sql`null::text`} as role_name_ar,
           ${customNames ? sql`cr.name_en` : sql`null::text`} as role_name_en,
           private.roles_include_privileged(i.tenant_id, array[i.primary_role] || i.additional_roles) as privileged
    from platform.invitations i
    join platform.persons p on p.tenant_id = i.tenant_id and p.id = i.person_id
    ${customNames ? sql`left join platform.custom_roles cr on cr.tenant_id = i.tenant_id and cr.code = i.primary_role` : sql``}
    -- Whether the caller may copy a code (managing rules per invitation, migration 20261018090000). Only
    -- the id leaves the database here: the codes stay in it (security review M2).
    left join (select x.invitation_id from private.invitation_codes() x) c on c.invitation_id = i.id
    where ${filter.state === undefined ? sql`true` : sql`${STATE} = ${filter.state}`}
    order by i.created_at desc, i.id`);
  return rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    email: r.email,
    displayNameAr: r.display_name_ar,
    displayNameEn: r.display_name_en,
    primaryRole: r.primary_role,
    primaryRoleName:
      r.role_name_ar !== null && r.role_name_en !== null
        ? { ar: r.role_name_ar, en: r.role_name_en }
        : null,
    privileged: r.privileged,
    state: r.state,
    sendCount: r.send_count,
    expiresAt: toDate(r.expires_at),
    createdAt: toDate(r.created_at),
    importId: r.import_id,
    additionalRoles: r.additional_roles ?? [],
    hasCode: r.has_code,
    locale: r.locale === 'en' ? 'en' : 'ar',
  }));
}

/** One invitation's code for a member who copies it, and the language its link opens in. */
export interface InvitationCode {
  readonly inviteCode: string;
  readonly locale: 'ar' | 'en';
}

/**
 * The current code of one invitation (copy code / copy link, Kawadir), when it is pending, unexpired and
 * sent and the caller may manage it (private.invitation_codes: an Organization Admin any; an HR Manager
 * only one without a privileged role); null otherwise. The calling action authorizes and audits the read
 * (security review M2); the code is never logged.
 */
export async function invitationCode(tx: ClaimsTx, id: string): Promise<InvitationCode | null> {
  const [row] = await tx.execute<{ invite_code: string; locale: string }>(sql`
    select c.invite_code, i.locale
    from private.invitation_codes(array[${id}::uuid]) c
    join platform.invitations i on i.id = c.invitation_id`);
  return row ? { inviteCode: row.invite_code, locale: row.locale === 'en' ? 'en' : 'ar' } : null;
}

/**
 * Revokes a pending (or expired) invitation and emits `invitation.revoked`. False when it is not
 * pending (accepted, already revoked, unknown or not visible). Throws DomainError ROLE_NOT_ALLOWED when
 * the database guard refuses the actor (e.g. an HR Manager on an invitation with a privileged role).
 */
export async function revokeInvitation(tx: ClaimsTx, id: string): Promise<boolean> {
  let revoked: unknown[];
  try {
    revoked = await tx.execute(sql`
      update platform.invitations set status = 'revoked'
      where id = ${id}::uuid and status = 'pending'
      returning id`);
  } catch (error) {
    throw invitationErrorOf(error);
  }
  if (revoked.length === 0) return false;
  await emitEvent(tx, { type: INVITATION_EVENTS.revoked, subject: id });
  return true;
}

/**
 * The roles an invitation gives (primary and additional) and whether one is privileged (standard, or a
 * custom role with a high-risk permission — computed now), or null when it is unknown or not visible to
 * the caller. Lets an action apply the privileged-role rule before changing the invitation.
 */
export async function getInvitationRoles(
  tx: ClaimsTx,
  id: string,
): Promise<{ primaryRole: string; additionalRoles: string[]; privileged: boolean } | null> {
  const [row] = await tx.execute<{
    primary_role: string;
    additional_roles: string[];
    privileged: boolean;
  }>(sql`
    select primary_role, additional_roles,
           private.roles_include_privileged(tenant_id, array[primary_role] || additional_roles) as privileged
    from platform.invitations where id = ${id}::uuid`);
  return row
    ? {
        primaryRole: row.primary_role,
        additionalRoles: row.additional_roles,
        privileged: row.privileged,
      }
    : null;
}

/** The outcome of a resend: a new code (the old link stops working), or why there is none. */
export type InvitationResend =
  | { readonly status: 'queued'; readonly inviteCode: string }
  | { readonly status: 'limit_reached' | 'not_pending' };

/**
 * Resend (Kawadir: a new code + 7 new days): while the invitation is pending — expired or not — was sent
 * (not held) and has had fewer than INVITATION_MAX_SENDS codes, the database issues a new code
 * (private.issue_invitation_code, actor-checked like a revocation: a user manager; an invitation with a
 * privileged role only an Organization Admin) and `invitation.resend_requested` is emitted (the mailer
 * e-mails the new code when e-mail is on). Copying a code is not a resend. Throws DomainError
 * ROLE_NOT_ALLOWED when the database refuses the actor.
 */
export async function requestInvitationResend(tx: ClaimsTx, id: string): Promise<InvitationResend> {
  let code: string | undefined;
  try {
    // In a savepoint: a refusal (limit, not pending) leaves the caller's transaction usable.
    code = await tx.transaction(async (savepoint) => {
      const [row] = await savepoint.execute<{ code: string }>(sql`
        select private.issue_invitation_code(${id}::uuid) as code`);
      return row?.code;
    });
  } catch (error) {
    const state = pgError(error)?.code;
    if (state === 'JI004') return { status: 'limit_reached' };
    if (state === 'JI005') return { status: 'not_pending' };
    throw invitationErrorOf(error);
  }
  if (!code) throw new Error('requestInvitationResend: no code issued');
  await emitEvent(tx, { type: INVITATION_EVENTS.resendRequested, subject: id });
  return { status: 'queued', inviteCode: code };
}

/** SQLSTATEs raised by the acceptance functions (migration 20261009090000). */
const ACCEPTANCE_ERRORS: Readonly<Record<string, InvitationErrorCode>> = {
  JI001: 'INVITATION_NOT_VALID',
  JI002: 'ALREADY_MEMBER',
  JI003: 'INVITATION_ACCOUNT_MISMATCH',
  // The role guard refused the invitation's roles together (BR-IAM-4). Unreachable while the link check
  // (invitation_inviter_may_grant) refuses them first; kept so a refusal never becomes a 500.
  JR001: 'INVITATION_NOT_VALID',
};

function acceptanceErrorOf(error: unknown): unknown {
  const code = pgError(error)?.code;
  // 23514: a value the acceptance writes was refused by a check (e.g. a display name without visible
  // text that slipped past the input validation): the link cannot be used with it.
  const mapped =
    code === '23514' ? 'INVITATION_NOT_VALID' : code ? ACCEPTANCE_ERRORS[code] : undefined;
  return mapped ? new DomainError<InvitationErrorCode>(mapped, { cause: error }) : error;
}

const SHA256_BYTES = 32;

export interface InvitationTokenApi {
  invitationByToken(tokenHash: Buffer): Promise<TokenLookup>;
}

/**
 * The link lookup over a database connected as `app_server`, in a transaction WITHOUT claims
 * (`set local role authenticated`, empty request.jwt.claims): the definer function answers only that
 * connection role.
 */
export function createInvitationTokenApi(getDb: () => AppDatabase): InvitationTokenApi {
  const withoutClaims = <T>(fn: (tx: ClaimsTx) => Promise<T>) => runWithClaims(getDb(), '', fn);
  return {
    async invitationByToken(tokenHash) {
      if (tokenHash.length !== SHA256_BYTES) return { state: 'invalid' };
      const [row] = await withoutClaims((tx) =>
        tx.execute<{
          state: string;
          tenant_name_ar: string | null;
          tenant_name_en: string | null;
          email: string | null;
          display_name_ar: string | null;
          display_name_en: string | null;
          locale: string | null;
        }>(sql`select * from private.invitation_by_token(${tokenHash}::bytea)`),
      );
      if (
        row?.state === 'valid' &&
        row.tenant_name_ar &&
        row.email &&
        (row.display_name_ar ?? row.display_name_en)
      ) {
        return {
          state: 'valid',
          email: row.email,
          locale: row.locale === 'en' ? 'en' : 'ar',
          organizationName: { ar: row.tenant_name_ar, en: row.tenant_name_en },
          displayName: { ar: row.display_name_ar, en: row.display_name_en },
        };
      }
      if (row?.state === 'expired' || row?.state === 'revoked' || row?.state === 'used') {
        return { state: row.state };
      }
      return { state: 'invalid' };
    },
  };
}

const defaultTokenApi = createInvitationTokenApi(() => getDatabase('app_server'));

/** State of an invitation link (public page): valid (with what screen 8 shows) or why not. */
export function invitationByToken(tokenHash: Buffer): Promise<TokenLookup> {
  return defaultTokenApi.invitationByToken(tokenHash);
}

/**
 * Accepts an invitation as the signed-in caller, inside the caller's withUserTx: the account just created
 * through the hook-gated sign-up (with the display names chosen on the page) or an existing account
 * after "sign in to accept". Its Auth e-mail must be the invitation's and its session valid. Active
 * membership, the invitation's roles, display names when given, audit and `invitation.accepted`; single
 * use. The caller's claims stay as they are (switch to the new organization afterwards). Throws
 * DomainError INVITATION_NOT_VALID, INVITATION_ACCOUNT_MISMATCH (other e-mail) or ALREADY_MEMBER.
 */
export async function acceptInvitationAsCaller(
  tx: ClaimsTx,
  tokenHash: Buffer,
  displayName: { readonly ar?: string | null; readonly en?: string | null } = {},
): Promise<{ tenantId: string }> {
  if (tokenHash.length !== SHA256_BYTES) {
    throw new DomainError<InvitationErrorCode>('INVITATION_NOT_VALID');
  }
  try {
    const [row] = await tx.execute<{ tenant_id: string }>(sql`
      select private.accept_invitation_as_caller(${tokenHash}::bytea, ${displayName.ar ?? null},
                                                 ${displayName.en ?? null}) as tenant_id`);
    if (!row) throw new Error('acceptInvitationAsCaller: no result');
    return { tenantId: row.tenant_id };
  } catch (error) {
    throw acceptanceErrorOf(error);
  }
}
