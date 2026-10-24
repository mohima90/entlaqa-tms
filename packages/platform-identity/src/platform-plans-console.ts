import 'server-only';
import { type AppError, type Result, appError, err, ok } from '@jadarat/platform-core';
import {
  type PlanField,
  type PlanInput,
  type PlanRow,
  PlanError,
  type PlatformTenantRow,
  type TenantPlanInput,
  type TenantPlanRow,
  type UserTx,
} from '@jadarat/platform-db';
import {
  type ConsoleInputParser,
  type PlatformConsoleDeps,
  platformConsoleAccess,
} from './platform-console';

/**
 * Plans and an organization's plan and status in the Super Admin console (WP-ADM-06; FR-ADM-13, FR-SUB-01,
 * FR-ADM-17; business flow EP-PLAN, agreed 24 Oct 2026): Platform → Plans (create and edit plans: name,
 * description, people and storage limits, the features included) and Platform → Organizations → an
 * organization (its plan, status, trial end date and limits special to it).
 *
 * Deny by default, as the rest of the console (platform-console.ts): a verified session of a user the
 * DATABASE says is a Super Admin — getUser before any change — else NOT_FOUND; the input is parsed only after
 * the access check (review L6). Every change is audited by the database (the platform's trail; an
 * organization's plan and status also in its own).
 */
export interface PlatformPlansConsoleDeps extends Pick<
  PlatformConsoleDeps,
  'getClaims' | 'withUserTx' | 'isPlatformAdmin' | 'listPlatformTenants'
> {
  readonly listPlans: (tx: UserTx) => Promise<readonly PlanRow[]>;
  readonly savePlan: (
    tx: UserTx,
    input: PlanInput,
  ) => Promise<{ readonly planId: string; readonly version: number }>;
  readonly listTenantPlans: (tx: UserTx) => Promise<readonly TenantPlanRow[]>;
  readonly setTenantPlan: (tx: UserTx, input: TenantPlanInput) => Promise<void>;
}

const notFound = (): Result<never, AppError> => err(appError('NOT_FOUND'));

/** The form fields the database names (its messages) → the form's paths. */
const FIELD_PATHS: Readonly<Record<PlanField, string>> = {
  name: 'name',
  description: 'description',
  max_people: 'maxPeople',
  max_storage_gb: 'maxStorageGb',
  features: 'features',
  plan: 'planId',
  tenant: 'form',
  status: 'status',
  trial_ends_at: 'trialEndsAt',
  max_people_override: 'maxPeopleOverride',
  max_storage_gb_override: 'maxStorageGbOverride',
};

function refusal(error: unknown): Result<never, AppError> {
  if (!(error instanceof PlanError)) throw error;
  switch (error.code) {
    case 'NOT_ALLOWED':
      return notFound();
    case 'PLAN_NAME_TAKEN':
      return err(appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'name', code: 'TAKEN' }] }));
    case 'PLAN_STALE':
      return err(appError('CONFLICT_VERSION'));
    case 'PLAN_INVALID_INPUT':
      return err(
        appError('VALIDATION_FAILED', {
          fieldErrors: [{ path: error.field ? FIELD_PATHS[error.field] : 'form', code: 'INVALID' }],
        }),
      );
  }
}

/** Platform → Plans: every plan, with how many organizations are on each. */
export async function loadPlatformPlans(
  deps: PlatformPlansConsoleDeps,
): Promise<Result<readonly PlanRow[], AppError>> {
  const access = await platformConsoleAccess(deps);
  if (!access.ok) return access;
  try {
    return ok(await deps.withUserTx(access.value, (tx) => deps.listPlans(tx)));
  } catch (error) {
    return refusal(error);
  }
}

/** «حفظ الخطة» / Save plan: creates (planId null) or updates a plan. */
export async function savePlanFromConsole(
  deps: PlatformPlansConsoleDeps,
  raw: unknown,
  parse: ConsoleInputParser<PlanInput>,
): Promise<Result<{ readonly planId: string; readonly version: number }, AppError>> {
  const access = await platformConsoleAccess(deps, { strict: true });
  if (!access.ok) return access;
  const parsed = parse(raw);
  if (!parsed.ok) return parsed;
  try {
    return ok(await deps.withUserTx(access.value, (tx) => deps.savePlan(tx, parsed.value)));
  } catch (error) {
    return refusal(error);
  }
}

/** Platform → Organizations: each organization's plan and usage (the list's plan column). */
export async function loadPlatformTenantPlans(
  deps: PlatformPlansConsoleDeps,
): Promise<Result<readonly TenantPlanRow[], AppError>> {
  const access = await platformConsoleAccess(deps);
  if (!access.ok) return access;
  try {
    return ok(await deps.withUserTx(access.value, (tx) => deps.listTenantPlans(tx)));
  } catch (error) {
    return refusal(error);
  }
}

/** What an organization's page shows: the organization, its plan and status, and the plans to choose from. */
export interface PlatformOrganizationDetail {
  readonly organization: PlatformTenantRow;
  readonly plan: TenantPlanRow;
  readonly plans: readonly PlanRow[];
}

/** Platform → Organizations → an organization. NOT_FOUND for an unknown organization too. */
export async function loadPlatformOrganizationDetail(
  deps: PlatformPlansConsoleDeps,
  tenantId: string,
): Promise<Result<PlatformOrganizationDetail, AppError>> {
  const access = await platformConsoleAccess(deps);
  if (!access.ok) return access;
  try {
    const detail = await deps.withUserTx(access.value, async (tx) => {
      const organization = (await deps.listPlatformTenants(tx)).find((o) => o.tenantId === tenantId);
      const plan = (await deps.listTenantPlans(tx)).find((p) => p.tenantId === tenantId);
      return organization && plan ? { organization, plan, plans: await deps.listPlans(tx) } : null;
    });
    return detail ? ok(detail) : notFound();
  } catch (error) {
    return refusal(error);
  }
}

/** «حفظ التغييرات» / Save changes: an organization's plan, status, trial end date and special limits. */
export async function setOrganizationPlanFromConsole(
  deps: PlatformPlansConsoleDeps,
  raw: unknown,
  parse: ConsoleInputParser<TenantPlanInput>,
): Promise<Result<null, AppError>> {
  const access = await platformConsoleAccess(deps, { strict: true });
  if (!access.ok) return access;
  const parsed = parse(raw);
  if (!parsed.ok) return parsed;
  try {
    await deps.withUserTx(access.value, (tx) => deps.setTenantPlan(tx, parsed.value));
    return ok(null);
  } catch (error) {
    return refusal(error);
  }
}
