import 'server-only';
import {
  type AppError,
  type Result,
  type VerifiedClaims,
  appError,
  defineErrorCodes,
  err,
  ok,
} from '@jadarat/platform-core';
import {
  type NewPlatformTenant,
  type PlatformAdminCode,
  PlanError,
  PlatformConsoleError,
  type PlatformTenantRow,
  type TenantPlanInput,
  type UserTx,
  type WithUserTx,
} from '@jadarat/platform-db';

/**
 * The Platform Super Admin console «مشرف المنصة» (FR-ADM-17; ADR 0013; Kawadir ATS's /organizations).
 * Framework-free: the Next.js adapter (auth-next.ts) supplies the claims verification and platform-db.
 *
 * Deny by default: every entry point verifies the session on the server (getClaims; getUser too —
 * `strict` — before anything that creates an organization or reveals or changes a code, ADR 0003 §2),
 * then asks the DATABASE whether the user is a Super Admin (private.is_platform_admin; every console
 * function checks it again itself). A signed-out visitor, a member of any organization and any other
 * account get NOT_FOUND — the console's pages and actions do not exist for them, whatever they send:
 * the actions pass their input unparsed with its parser, which runs only AFTER the access check (security
 * review L6), so validation errors are for Super Admins only. A Super Admin needs no organization: the
 * session has no tenant claim.
 */

/** Validates an action's untrusted input (zod, apps/suite lib/platform-console-input.ts). */
export type ConsoleInputParser<T> = (raw: unknown) => Result<T, AppError>;
export interface PlatformConsoleDeps {
  readonly getClaims: (options: {
    readonly strict: boolean;
  }) => Promise<Result<VerifiedClaims, AppError>>;
  readonly withUserTx: WithUserTx;
  readonly isPlatformAdmin: (tx: UserTx) => Promise<boolean>;
  readonly listPlatformTenants: (tx: UserTx) => Promise<readonly PlatformTenantRow[]>;
  readonly createPlatformTenant: (
    tx: UserTx,
    input: NewPlatformTenant,
  ) => Promise<{ tenantId: string; invitationId: string; inviteCode: string }>;
  readonly platformAdminInvitationCode: (
    tx: UserTx,
    tenantId: string,
  ) => Promise<PlatformAdminCode>;
  readonly reissuePlatformAdminCode: (tx: UserTx, tenantId: string) => Promise<PlatformAdminCode>;
  /** The new organization's plan and trial (WP-ADM-06), in the same transaction as its creation. */
  readonly setTenantPlan?: (tx: UserTx, input: TenantPlanInput) => Promise<void>;
}

/** A trial's length when an organization is created (WP-ADM-06, PO 24 Oct 2026). */
export const TRIAL_DAYS = 30;

export const PlatformConsoleErrors = defineErrorCodes({
  /** The organization has no pending Organization Admin invitation from the console (it joined already). */
  PLATFORM_NO_PENDING_ADMIN: { status: 409, messageKey: 'platform.errors.noPendingAdmin' },
});

/** The answer to everyone who is not a Super Admin: the console does not exist. */
const notFound = (): Result<never, AppError> => err(appError('NOT_FOUND'));

/** The field and code of a refusal the form shows next to a field. */
function fieldError(path: string, code: string): AppError {
  return appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });
}

const FIELD_PATHS = {
  slug: 'slug',
  name_ar: 'nameAr',
  name_en: 'nameEn',
  admin_email: 'adminEmail',
  admin_name: 'adminFirstNameAr',
  locale: 'locale',
} as const;

/** A console refusal as the action's answer; anything else is thrown (an internal error). */
function refusal(error: unknown): Result<never, AppError> {
  // The new organization's plan (WP-ADM-06): a plan that no longer exists, or a refused trial.
  if (error instanceof PlanError) {
    return error.code === 'NOT_ALLOWED'
      ? notFound()
      : err(fieldError(error.field === 'plan' ? 'planId' : 'form', 'INVALID'));
  }
  if (!(error instanceof PlatformConsoleError)) throw error;
  switch (error.code) {
    case 'NOT_PLATFORM_ADMIN':
      return notFound();
    case 'SLUG_TAKEN':
      return err(fieldError('slug', 'SLUG_TAKEN'));
    case 'PLATFORM_INVALID_INPUT':
      return err(fieldError(error.field ? FIELD_PATHS[error.field] : 'form', 'INVALID'));
    case 'NO_PENDING_ADMIN':
      return err(appError(PlatformConsoleErrors.PLATFORM_NO_PENDING_ADMIN));
    case 'OWN_EMAIL':
      return err(fieldError('adminEmail', 'OWN_EMAIL'));
  }
}

/**
 * The verified claims of a Super Admin's session, or NOT_FOUND. `strict`: the Auth server confirms the
 * session first (getUser).
 */
export async function platformConsoleAccess(
  deps: Pick<PlatformConsoleDeps, 'getClaims' | 'withUserTx' | 'isPlatformAdmin'>,
  options: { readonly strict: boolean } = { strict: false },
): Promise<Result<VerifiedClaims, AppError>> {
  const claims = await deps.getClaims(options);
  if (!claims.ok) return notFound();
  const admin = await deps.withUserTx(claims.value, (tx) => deps.isPlatformAdmin(tx));
  return admin ? claims : notFound();
}

/** Is the current session a Super Admin's? (Sign-in routing and the organization chooser.) */
export async function isPlatformAdminSession(deps: PlatformConsoleDeps): Promise<boolean> {
  return (await platformConsoleAccess(deps)).ok;
}

/** The organizations page. */
export async function loadPlatformOrganizations(
  deps: PlatformConsoleDeps,
): Promise<Result<readonly PlatformTenantRow[], AppError>> {
  const access = await platformConsoleAccess(deps);
  if (!access.ok) return access;
  try {
    return ok(await deps.withUserTx(access.value, (tx) => deps.listPlatformTenants(tx)));
  } catch (error) {
    return refusal(error);
  }
}

/** «إنشاء منظمة» / Create organization: the organization and its Organization Admin's first code. */
export async function createOrganizationFromConsole(
  deps: PlatformConsoleDeps,
  input: NewPlatformTenant,
): Promise<Result<{ tenantId: string; inviteCode: string; locale: 'ar' | 'en' }, AppError>>;
/** The same with untrusted input: parsed only after the access check (review L6). */
export async function createOrganizationFromConsole(
  deps: PlatformConsoleDeps,
  raw: unknown,
  parse: ConsoleInputParser<NewPlatformTenant>,
): Promise<Result<{ tenantId: string; inviteCode: string; locale: 'ar' | 'en' }, AppError>>;
export async function createOrganizationFromConsole(
  deps: PlatformConsoleDeps,
  raw: unknown,
  parse?: ConsoleInputParser<NewPlatformTenant>,
): Promise<Result<{ tenantId: string; inviteCode: string; locale: 'ar' | 'en' }, AppError>> {
  const access = await platformConsoleAccess(deps, { strict: true });
  if (!access.ok) return access;
  const parsed = parse ? parse(raw) : ok(raw as NewPlatformTenant);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  try {
    const created = await deps.withUserTx(access.value, async (tx) => {
      const tenant = await deps.createPlatformTenant(tx, input);
      // Its plan and a trial (WP-ADM-06): the same transaction — both happen, or neither.
      const planId = input.planId ?? null;
      if (deps.setTenantPlan && (planId !== null || input.trial === true)) {
        await deps.setTenantPlan(tx, {
          tenantId: tenant.tenantId,
          planId,
          status: input.trial === true ? 'trial' : 'active',
          trialEndsAt: input.trial === true ? new Date(Date.now() + TRIAL_DAYS * 86_400_000) : null,
          maxPeopleOverride: null,
          maxStorageGbOverride: null,
        });
      }
      return tenant;
    });
    return ok({ tenantId: created.tenantId, inviteCode: created.inviteCode, locale: input.locale });
  } catch (error) {
    return refusal(error);
  }
}

/** The organization an action is about: access first, then its (untrusted) id. */
async function organizationAccess(
  deps: PlatformConsoleDeps,
  raw: unknown,
  parse: ConsoleInputParser<string> | undefined,
): Promise<Result<{ claims: VerifiedClaims; tenantId: string }, AppError>> {
  const access = await platformConsoleAccess(deps, { strict: true });
  if (!access.ok) return access;
  const tenantId = parse ? parse(raw) : ok(raw as string);
  if (!tenantId.ok) return tenantId;
  return ok({ claims: access.value, tenantId: tenantId.value });
}

/** Copy the Organization Admin's link or code (an audited read; nothing changes). */
export async function viewOrganizationAdminCode(
  deps: PlatformConsoleDeps,
  tenantId: string,
): Promise<Result<PlatformAdminCode, AppError>>;
export async function viewOrganizationAdminCode(
  deps: PlatformConsoleDeps,
  raw: unknown,
  parse: ConsoleInputParser<string>,
): Promise<Result<PlatformAdminCode, AppError>>;
export async function viewOrganizationAdminCode(
  deps: PlatformConsoleDeps,
  raw: unknown,
  parse?: ConsoleInputParser<string>,
): Promise<Result<PlatformAdminCode, AppError>> {
  const target = await organizationAccess(deps, raw, parse);
  if (!target.ok) return target;
  const { claims, tenantId } = target.value;
  try {
    return ok(
      await deps.withUserTx(claims, (tx) => deps.platformAdminInvitationCode(tx, tenantId)),
    );
  } catch (error) {
    return refusal(error);
  }
}

/**
 * «رمز جديد» / New code: issued by this Super Admin; the old link stops working, 7 more days (another
 * issuer's invitation is replaced by a new one, review M1).
 */
export async function reissueOrganizationAdminCode(
  deps: PlatformConsoleDeps,
  tenantId: string,
): Promise<Result<PlatformAdminCode, AppError>>;
export async function reissueOrganizationAdminCode(
  deps: PlatformConsoleDeps,
  raw: unknown,
  parse: ConsoleInputParser<string>,
): Promise<Result<PlatformAdminCode, AppError>>;
export async function reissueOrganizationAdminCode(
  deps: PlatformConsoleDeps,
  raw: unknown,
  parse?: ConsoleInputParser<string>,
): Promise<Result<PlatformAdminCode, AppError>> {
  const target = await organizationAccess(deps, raw, parse);
  if (!target.ok) return target;
  const { claims, tenantId } = target.value;
  try {
    return ok(await deps.withUserTx(claims, (tx) => deps.reissuePlatformAdminCode(tx, tenantId)));
  } catch (error) {
    return refusal(error);
  }
}
