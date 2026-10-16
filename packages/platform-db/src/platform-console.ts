import 'server-only';
import { sql } from 'drizzle-orm';
import type { ClaimsTx } from './claims-tx';
import { DomainError } from './domain-error';
import { pgError } from './pg-error';

/**
 * The Platform Super Admin console «مشرف المنصة» (FR-ADM-17, migration 20261018100000; ADR 0013). Every
 * helper runs inside the signed-in user's withUserTx — a session WITHOUT an organization is fine — and
 * calls one reviewed SECURITY DEFINER function, which checks the login role (app_server), the session and
 * that the user is a Super Admin itself (deny by default: anyone else gets 42501 → NOT_PLATFORM_ADMIN).
 * Audit records are written by the database functions (the platform's trail and the organization's own);
 * codes are returned to the Super Admin only and never logged or audited.
 */

/** Codes of the DomainErrors thrown by the console helpers. */
export type PlatformConsoleErrorCode =
  /** Not a Super Admin (or no valid session): the web app answers 404. */
  | 'NOT_PLATFORM_ADMIN'
  /** Invalid input, refused by the database (the field is in `field`). */
  | 'PLATFORM_INVALID_INPUT'
  /** The organization's short name is taken or reserved. */
  | 'SLUG_TAKEN'
  /** The organization has no pending Organization Admin invitation from the console. */
  | 'NO_PENDING_ADMIN';

/** The fields the database validates when creating an organization. */
export type PlatformTenantField =
  'slug' | 'name_ar' | 'name_en' | 'admin_email' | 'admin_name' | 'locale';

const FIELDS: readonly PlatformTenantField[] = [
  'slug',
  'name_ar',
  'name_en',
  'admin_email',
  'admin_name',
  'locale',
];

/** A refusal of the console; `field` for PLATFORM_INVALID_INPUT. */
export class PlatformConsoleError extends DomainError<PlatformConsoleErrorCode> {
  readonly field: PlatformTenantField | null;
  constructor(
    code: PlatformConsoleErrorCode,
    options: { readonly cause?: unknown; readonly field?: PlatformTenantField | null } = {},
  ) {
    super(code, { cause: options.cause });
    this.field = options.field ?? null;
  }
}

/** Maps the console functions' refusals to PlatformConsoleErrors; anything else is returned as is. */
export function platformConsoleErrorOf(error: unknown): unknown {
  const pg = pgError(error);
  switch (pg?.code) {
    case '42501':
      return new PlatformConsoleError('NOT_PLATFORM_ADMIN', { cause: error });
    case 'JP001': {
      const field = FIELDS.find((f) => f === pg.message) ?? null;
      return new PlatformConsoleError('PLATFORM_INVALID_INPUT', { cause: error, field });
    }
    case 'JP002':
      return new PlatformConsoleError('SLUG_TAKEN', { cause: error });
    case 'JP003':
      return new PlatformConsoleError('NO_PENDING_ADMIN', { cause: error });
    default:
      return error;
  }
}

/** The Organization Admin's state on the console's list. */
export type PlatformAdminState = 'active' | 'pending' | 'expired' | 'none';

export interface PlatformTenantRow {
  readonly tenantId: string;
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly status: 'trial' | 'active' | 'suspended' | 'cancelled';
  readonly createdAt: Date;
  /** Active members. */
  readonly memberCount: number;
  readonly adminState: PlatformAdminState;
  /** While the Organization Admin is not active: the console invitation's language and expiry. */
  readonly adminInvitationLocale: 'ar' | 'en' | null;
  readonly adminInvitationExpiresAt: Date | null;
}

export interface NewPlatformTenant {
  /** The short name (`^[a-z0-9-]{3,40}$`, no hyphen at either end): checked again by the database. */
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn?: string | null | undefined;
  readonly adminEmail: string;
  readonly adminFirstNameAr?: string | null | undefined;
  readonly adminFamilyNameAr?: string | null | undefined;
  readonly adminFirstNameEn?: string | null | undefined;
  readonly adminFamilyNameEn?: string | null | undefined;
  /** The invitation's language: the link opens the sign-up page in it. */
  readonly locale: 'ar' | 'en';
}

/** An Organization Admin invitation's current code, with what the link needs. */
export interface PlatformAdminCode {
  readonly inviteCode: string;
  readonly locale: 'ar' | 'en';
  readonly expiresAt: Date;
}

const STATUSES = ['trial', 'active', 'suspended', 'cancelled'] as const;
const ADMIN_STATES = ['active', 'pending', 'expired', 'none'] as const;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function locale(value: string | null): 'ar' | 'en' {
  return value === 'ar' ? 'ar' : 'en';
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw platformConsoleErrorOf(error);
  }
}

/** Is the signed-in caller a Super Admin (valid session)? Never throws for a refusal: false. */
export async function isPlatformAdmin(tx: ClaimsTx): Promise<boolean> {
  const rows = await tx.execute<{ yes: boolean }>(sql`select private.is_platform_admin() as yes`);
  return rows[0]?.yes === true;
}

/** Every organization, newest first (no personal data). Throws NOT_PLATFORM_ADMIN. */
export async function listPlatformTenants(tx: ClaimsTx): Promise<PlatformTenantRow[]> {
  const rows = await run(() =>
    tx.execute<{
      tenant_id: string;
      slug: string;
      name_ar: string;
      name_en: string | null;
      status: string;
      created_at: Date | string;
      member_count: number | string;
      admin_state: string;
      admin_invitation_locale: string | null;
      admin_invitation_expires_at: Date | string | null;
    }>(sql`select tenant_id, slug, name_ar, name_en, status, created_at, member_count, admin_state,
                  admin_invitation_locale, admin_invitation_expires_at
           from private.platform_list_tenants()`),
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    slug: r.slug,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    status: STATUSES.find((s) => s === r.status) ?? 'suspended',
    createdAt: toDate(r.created_at),
    memberCount: Number(r.member_count),
    adminState: ADMIN_STATES.find((s) => s === r.admin_state) ?? 'none',
    adminInvitationLocale:
      r.admin_invitation_locale === null ? null : locale(r.admin_invitation_locale),
    adminInvitationExpiresAt:
      r.admin_invitation_expires_at === null ? null : toDate(r.admin_invitation_expires_at),
  }));
}

/**
 * Creates the organization and its Organization Admin's pending invitation; returns the first code (for
 * the Super Admin to copy). Throws NOT_PLATFORM_ADMIN, PLATFORM_INVALID_INPUT (with the field) or
 * SLUG_TAKEN.
 */
export async function createPlatformTenant(
  tx: ClaimsTx,
  input: NewPlatformTenant,
): Promise<{ tenantId: string; invitationId: string; inviteCode: string }> {
  const rows = await run(() =>
    tx.execute<{ tenant_id: string; invitation_id: string; invite_code: string }>(sql`
      select tenant_id, invitation_id, invite_code
      from private.platform_create_tenant(
        ${input.slug}, ${input.nameAr.trim()}, ${blankToNull(input.nameEn)},
        ${input.adminEmail.trim().toLowerCase()},
        ${blankToNull(input.adminFirstNameAr)}, ${blankToNull(input.adminFamilyNameAr)},
        ${blankToNull(input.adminFirstNameEn)}, ${blankToNull(input.adminFamilyNameEn)},
        ${input.locale})`),
  );
  const row = rows[0];
  if (!row?.invite_code) throw new Error('createPlatformTenant: no code returned');
  return { tenantId: row.tenant_id, invitationId: row.invitation_id, inviteCode: row.invite_code };
}

function codeOf(
  rows: readonly { invite_code: string; locale: string; expires_at: Date | string }[],
): PlatformAdminCode {
  const row = rows[0];
  if (!row?.invite_code) throw new PlatformConsoleError('NO_PENDING_ADMIN');
  return {
    inviteCode: row.invite_code,
    locale: locale(row.locale),
    expiresAt: toDate(row.expires_at),
  };
}

/** The pending Organization Admin invitation's current code (audited read). Throws NO_PENDING_ADMIN. */
export async function platformAdminInvitationCode(
  tx: ClaimsTx,
  tenantId: string,
): Promise<PlatformAdminCode> {
  const rows = await run(() =>
    tx.execute<{ invite_code: string; locale: string; expires_at: Date | string }>(sql`
      select invite_code, locale, expires_at from private.platform_admin_invitation_code(${tenantId}::uuid)`),
  );
  return codeOf(rows);
}

/** A new code for it (the old one stops working; 7 more days). Throws NO_PENDING_ADMIN. */
export async function reissuePlatformAdminCode(
  tx: ClaimsTx,
  tenantId: string,
): Promise<PlatformAdminCode> {
  const rows = await run(() =>
    tx.execute<{ invite_code: string; locale: string; expires_at: Date | string }>(sql`
      select invite_code, locale, expires_at from private.platform_reissue_admin_code(${tenantId}::uuid)`),
  );
  return codeOf(rows);
}
