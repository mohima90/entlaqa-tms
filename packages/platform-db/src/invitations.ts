import 'server-only';
import { createHash } from 'node:crypto';
import { type SQL, sql } from 'drizzle-orm';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import { DomainError } from './domain-error';
import { emitEvent } from './events';
import { pgError } from './user-admin';

/**
 * Invitations (FR-IAM-03, T-M2-07; docs/engineering/invitations-contract.md §2, migration
 * 20261009090000). Request-path helpers: inviting, listing, revoking and resending run inside the
 * signed-in user's withUserTx (the database guard checks the actor: Organization Admin or HR Manager,
 * privileged roles by an Organization Admin only); looking a link up runs on a plain app_server
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

/** At most this many e-mails per invitation: the first one and 3 resends. */
export const INVITATION_MAX_SENDS = 4;

/** Codes of the DomainErrors thrown by the invitation helpers. */
export type InvitationErrorCode =
  | 'EMAIL_TAKEN'
  | 'EMPLOYEE_NUMBER_TAKEN'
  | 'ROLE_NOT_ALLOWED'
  /** BR-IAM-4: the invitation would give both the Organization Admin and HR Manager roles. */
  | 'ROLE_CONFLICT'
  | 'INVITATION_NOT_VALID'
  | 'INVITATION_ACCOUNT_MISMATCH'
  | 'ALREADY_MEMBER';

export type InvitationState = 'pending' | 'expired' | 'accepted' | 'revoked';

export interface NewInvitation {
  /** Lowercase work e-mail (trimmed and lower-cased again here). */
  readonly email: string;
  readonly firstNameAr: string;
  readonly familyNameAr: string;
  readonly firstNameEn?: string | null;
  readonly familyNameEn?: string | null;
  readonly departmentId?: string | null;
  readonly branchId?: string | null;
  readonly managerPersonId?: string | null;
  readonly employeeNumber?: string | null;
  readonly primaryRole: string;
  readonly additionalRoles: readonly string[];
  readonly locale: 'ar' | 'en';
}

export interface InvitationRow {
  readonly id: string;
  readonly personId: string;
  readonly email: string;
  readonly displayNameAr: string;
  readonly displayNameEn: string | null;
  readonly primaryRole: string;
  readonly state: InvitationState;
  readonly sendCount: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export type TokenLookup =
  | {
      readonly state: 'valid';
      readonly email: string;
      readonly locale: 'ar' | 'en';
      readonly organizationName: { ar: string; en: string | null };
      readonly displayName: { ar: string; en: string | null };
    }
  | { readonly state: 'expired' | 'revoked' | 'used' | 'invalid' };

/** SHA-256 of the token's UTF-8 bytes: the only form of a token the database ever sees. */
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
  // Separation of duties (BR-IAM-4, migration 20261010090000).
  if (pg?.code === 'JR001')
    return new DomainError<InvitationErrorCode>('ROLE_CONFLICT', { cause: error });
  return error;
}

/**
 * Creates the person (with their placement), the pending invitation (no token: the mailer job issues
 * it) and the `invitation.created` event, in the caller's transaction. A refusal leaves the transaction
 * aborted (the action rolls back). Throws DomainError EMAIL_TAKEN, EMPLOYEE_NUMBER_TAKEN,
 * ROLE_NOT_ALLOWED (the actor may not invite, or not with these roles) or ROLE_CONFLICT (the roles may
 * not go together, BR-IAM-4).
 */
export async function createInvitation(
  tx: ClaimsTx,
  input: NewInvitation,
): Promise<{ invitationId: string; personId: string }> {
  const email = input.email.trim().toLowerCase();
  const firstNameAr = input.firstNameAr.trim();
  const familyNameAr = input.familyNameAr.trim();
  const firstNameEn = blankToNull(input.firstNameEn);
  const familyNameEn = blankToNull(input.familyNameEn);
  const employeeNumber = blankToNull(input.employeeNumber);
  try {
    const [person] = await tx.execute<{ id: string }>(sql`
      insert into platform.persons
        (display_name_ar, display_name_en, first_name_ar, family_name_ar, first_name_en, family_name_en,
         email, employee_number, preferred_locale)
      values (${joinNames(firstNameAr, familyNameAr) ?? ''}, ${joinNames(firstNameEn, familyNameEn)},
              ${blankToNull(firstNameAr)}, ${blankToNull(familyNameAr)}, ${firstNameEn}, ${familyNameEn},
              ${email}, ${employeeNumber}, ${input.locale})
      returning id`);
    if (!person) throw new Error('createInvitation: no person returned');
    await tx.execute(sql`
      insert into platform.person_employment (person_id, department_id, branch_id, manager_person_id)
      values (${person.id}::uuid, ${input.departmentId ?? null}::uuid, ${input.branchId ?? null}::uuid,
              ${input.managerPersonId ?? null}::uuid)`);
    const [invitation] = await tx.execute<{ id: string }>(sql`
      insert into platform.invitations (person_id, email, locale, primary_role, additional_roles)
      values (${person.id}::uuid, ${email}, ${input.locale}, ${input.primaryRole},
              ${textArray(input.additionalRoles)})
      returning id`);
    if (!invitation) throw new Error('createInvitation: no invitation returned');
    await emitEvent(tx, { type: INVITATION_EVENTS.created, subject: invitation.id });
    return { invitationId: invitation.id, personId: person.id };
  } catch (error) {
    throw invitationErrorOf(error);
  }
}

/** The SQL expression of an invitation's state (pending past its expiry reads as expired). */
const STATE = sql`case when i.status = 'pending' and i.expires_at <= now() then 'expired'
                       when i.status = 'pending' then 'pending' else i.status end`;

/**
 * The organization's invitations, newest first, optionally of one state. Only user managers see any
 * (the read policy); `expired` = pending past its expiry.
 */
export async function listInvitations(
  tx: ClaimsTx,
  filter: { state?: InvitationState } = {},
): Promise<InvitationRow[]> {
  const rows = await tx.execute<{
    id: string;
    person_id: string;
    email: string;
    display_name_ar: string;
    display_name_en: string | null;
    primary_role: string;
    state: InvitationState;
    send_count: number;
    expires_at: Date | string;
    created_at: Date | string;
  }>(sql`
    select i.id, i.person_id, i.email, p.display_name_ar, p.display_name_en, i.primary_role,
           ${STATE} as state, i.send_count, i.expires_at, i.created_at
    from platform.invitations i
    join platform.persons p on p.tenant_id = i.tenant_id and p.id = i.person_id
    where ${filter.state === undefined ? sql`true` : sql`${STATE} = ${filter.state}`}
    order by i.created_at desc, i.id`);
  return rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    email: r.email,
    displayNameAr: r.display_name_ar,
    displayNameEn: r.display_name_en,
    primaryRole: r.primary_role,
    state: r.state,
    sendCount: r.send_count,
    expiresAt: toDate(r.expires_at),
    createdAt: toDate(r.created_at),
  }));
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
 * The roles an invitation gives (primary and additional), or null when it is unknown or not visible to
 * the caller. Lets an action apply the privileged-role rule before changing the invitation.
 */
export async function getInvitationRoles(
  tx: ClaimsTx,
  id: string,
): Promise<{ primaryRole: string; additionalRoles: string[] } | null> {
  const [row] = await tx.execute<{ primary_role: string; additional_roles: string[] }>(sql`
    select primary_role, additional_roles from platform.invitations where id = ${id}::uuid`);
  return row ? { primaryRole: row.primary_role, additionalRoles: row.additional_roles } : null;
}

/**
 * Asks the mailer for a new e-mail (new link; the old one stops working) while the invitation is
 * pending — expired or not — and fewer than INVITATION_MAX_SENDS e-mails went out. The request is a
 * write the database checks like a revocation (resend_requested_at, stamped with the actor: a user
 * manager; an invitation with a privileged role only an Organization Admin), then
 * `invitation.resend_requested` is emitted. Throws DomainError ROLE_NOT_ALLOWED when the database
 * refuses the actor.
 */
export async function requestInvitationResend(
  tx: ClaimsTx,
  id: string,
): Promise<'queued' | 'limit_reached' | 'not_pending'> {
  let requested: unknown[];
  try {
    // clock_timestamp(): a second request in the same transaction is still a change the trigger checks.
    requested = await tx.execute(sql`
      update platform.invitations set resend_requested_at = clock_timestamp()
      where id = ${id}::uuid and status = 'pending' and send_count < ${INVITATION_MAX_SENDS}
      returning id`);
  } catch (error) {
    throw invitationErrorOf(error);
  }
  if (requested.length === 0) {
    const [row] = await tx.execute<{ status: string; send_count: number }>(sql`
      select status, send_count from platform.invitations where id = ${id}::uuid`);
    return row?.status === 'pending' && row.send_count >= INVITATION_MAX_SENDS
      ? 'limit_reached'
      : 'not_pending';
  }
  await emitEvent(tx, { type: INVITATION_EVENTS.resendRequested, subject: id });
  return 'queued';
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
      if (row?.state === 'valid' && row.tenant_name_ar && row.email && row.display_name_ar) {
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
