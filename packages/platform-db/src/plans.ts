import 'server-only';
import { sql } from 'drizzle-orm';
import type { ClaimsTx } from './claims-tx';
import { DomainError } from './domain-error';
import { pgError } from './pg-error';

/**
 * Plans, limits and the organization's status (WP-ADM-06; FR-ADM-13, FR-SUB-01, FR-ADM-17; migrations
 * 20261027100000–100200). The Platform Super Admin creates plans (people and storage limits, the features
 * included) and sets each organization's plan, status, trial end date and special limits; the Organization
 * Admin sees them (read-only); every member's organization has the features of its plan. The database
 * decides everything (who, validation, the limits at the moment of an action); these are its calls.
 */

/** The product features a plan can include, in the product's order (private.plan_feature_codes). */
export const PLAN_FEATURES = [
  'planning',
  'needs_forms',
  'courses',
  'bulk_import',
  'branding',
  'email_integration',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const TENANT_STATUSES = ['trial', 'active', 'suspended', 'cancelled'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** Codes of the DomainErrors thrown by the plan helpers. */
export type PlanErrorCode =
  /** Not a Super Admin / not the Organization Admin (or no valid session): the web app answers 404. */
  | 'NOT_ALLOWED'
  /** Invalid input, refused by the database (the field is in `field`). */
  | 'PLAN_INVALID_INPUT'
  /** Another plan has this name (whatever the case). */
  | 'PLAN_NAME_TAKEN'
  /** The plan was changed by someone else since it was opened. */
  | 'PLAN_STALE';

/** The fields the database validates (its messages). */
export const PLAN_FIELDS = [
  'name',
  'description',
  'max_people',
  'max_storage_gb',
  'features',
  'plan',
  'tenant',
  'status',
  'trial_ends_at',
  'max_people_override',
  'max_storage_gb_override',
] as const;
export type PlanField = (typeof PLAN_FIELDS)[number];

export class PlanError extends DomainError<PlanErrorCode> {
  readonly field: PlanField | null;
  constructor(
    code: PlanErrorCode,
    options: { readonly cause?: unknown; readonly field?: PlanField | null } = {},
  ) {
    super(code, { cause: options.cause });
    this.field = options.field ?? null;
  }
}

/** Maps the plan functions' refusals to PlanErrors; anything else is returned as is. */
export function planErrorOf(error: unknown): unknown {
  const pg = pgError(error);
  switch (pg?.code) {
    case '42501':
      return new PlanError('NOT_ALLOWED', { cause: error });
    case 'JP001':
      return new PlanError('PLAN_INVALID_INPUT', {
        cause: error,
        field: PLAN_FIELDS.find((f) => f === pg.message) ?? null,
      });
    case 'JP006':
      return new PlanError('PLAN_NAME_TAKEN', { cause: error, field: 'name' });
    case 'JP007':
      return new PlanError('PLAN_STALE', { cause: error });
    default:
      return error;
  }
}

/**
 * Which limit or feature an action ran into (JL001 people, JL002 storage, JL003 a feature not in the plan),
 * or null. For the refusal messages of the actions that add people, files or settings.
 */
export function planLimitOf(error: unknown): 'people' | 'storage' | 'feature' | null {
  switch (pgError(error)?.code) {
    case 'JL001':
      return 'people';
    case 'JL002':
      return 'storage';
    case 'JL003':
      return 'feature';
    default:
      return null;
  }
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw planErrorOf(error);
  }
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function features(value: unknown): PlanFeature[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.replace(/[{}\s]/g, '').split(',')
      : [];
  return PLAN_FEATURES.filter((f) => list.includes(f));
}

function status(value: unknown): TenantStatus {
  return TENANT_STATUSES.find((s) => s === value) ?? 'suspended';
}

const intOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

// ---------------------------------------------------------------------------------------------------
// The console (a signed-in Super Admin; every function checks it itself)
// ---------------------------------------------------------------------------------------------------

export interface PlanRow {
  readonly planId: string;
  readonly name: string;
  readonly description: string | null;
  /** Null: no limit. */
  readonly maxPeople: number | null;
  readonly maxStorageGb: number | null;
  readonly features: readonly PlanFeature[];
  /** Optimistic concurrency token. */
  readonly version: number;
  /** Organizations on the plan. */
  readonly tenantCount: number;
}

export interface PlanInput {
  /** Null: a new plan. */
  readonly planId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly maxPeople: number | null;
  readonly maxStorageGb: number | null;
  readonly features: readonly PlanFeature[];
  /** The version edited (null for a new plan). */
  readonly version: number | null;
}

/** Every plan, by name. Throws NOT_ALLOWED. */
export async function listPlans(tx: ClaimsTx): Promise<PlanRow[]> {
  const rows = await run(() =>
    tx.execute(sql`
      select plan_id, name, description, max_people, max_storage_gb, features, version, tenant_count
      from private.platform_list_plans()`),
  );
  return rows.map((r) => ({
    planId: String(r.plan_id),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    maxPeople: intOrNull(r.max_people),
    maxStorageGb: intOrNull(r.max_storage_gb),
    features: features(r.features),
    version: Number(r.version),
    tenantCount: Number(r.tenant_count),
  }));
}

/** Creates or updates a plan (audited). Throws NOT_ALLOWED, PLAN_INVALID_INPUT, PLAN_NAME_TAKEN, PLAN_STALE. */
export async function savePlan(
  tx: ClaimsTx,
  input: PlanInput,
): Promise<{ planId: string; version: number }> {
  const list = `{${input.features.join(',')}}`;
  const rows = await run(() =>
    tx.execute<{ plan_id: string; version: number | string }>(sql`
      select plan_id, version from private.platform_save_plan(
        ${input.planId}::uuid, ${input.name}, ${input.description}, ${input.maxPeople}::integer,
        ${input.maxStorageGb}::integer, ${list}::text[], ${input.version}::integer)`),
  );
  const row = rows[0];
  if (!row) throw new Error('savePlan: no row returned');
  return { planId: row.plan_id, version: Number(row.version) };
}

/** An organization's plan, status, trial, limits and usage, for the console. */
export interface TenantPlanRow {
  readonly tenantId: string;
  readonly planId: string | null;
  readonly planName: string | null;
  readonly status: TenantStatus;
  readonly trialEndsAt: Date | null;
  readonly maxPeopleOverride: number | null;
  readonly maxStorageGbOverride: number | null;
  /** The limits in force (the special one, else the plan's; null: no limit). */
  readonly maxPeople: number | null;
  readonly maxStorageGb: number | null;
  readonly peopleUsed: number;
  readonly storageUsedBytes: number;
}

/** Every organization's plan and usage. Throws NOT_ALLOWED. */
export async function listTenantPlans(tx: ClaimsTx): Promise<TenantPlanRow[]> {
  const rows = await run(() =>
    tx.execute(sql`
      select tenant_id, plan_id, plan_name, status, trial_ends_at, max_people_override,
             max_storage_gb_override, max_people, max_storage_gb, people_used, storage_used_bytes
      from private.platform_tenant_plans()`),
  );
  return rows.map((r) => ({
    tenantId: String(r.tenant_id),
    planId: (r.plan_id as string | null) ?? null,
    planName: (r.plan_name as string | null) ?? null,
    status: status(r.status),
    trialEndsAt: r.trial_ends_at ? toDate(r.trial_ends_at as Date | string) : null,
    maxPeopleOverride: intOrNull(r.max_people_override),
    maxStorageGbOverride: intOrNull(r.max_storage_gb_override),
    maxPeople: intOrNull(r.max_people),
    maxStorageGb: intOrNull(r.max_storage_gb),
    peopleUsed: Number(r.people_used),
    storageUsedBytes: Number(r.storage_used_bytes),
  }));
}

export interface TenantPlanInput {
  readonly tenantId: string;
  readonly planId: string | null;
  readonly status: TenantStatus;
  /** Only (and always) during a trial. */
  readonly trialEndsAt: Date | null;
  readonly maxPeopleOverride: number | null;
  readonly maxStorageGbOverride: number | null;
}

/** Sets an organization's plan, status, trial end and special limits (audited). Throws NOT_ALLOWED, PLAN_INVALID_INPUT. */
export async function setTenantPlan(tx: ClaimsTx, input: TenantPlanInput): Promise<void> {
  await run(() =>
    tx.execute(sql`
      select private.platform_set_tenant_plan(
        ${input.tenantId}::uuid, ${input.planId}::uuid, ${input.status},
        ${input.trialEndsAt ? input.trialEndsAt.toISOString() : null}::timestamptz,
        ${input.maxPeopleOverride}::integer, ${input.maxStorageGbOverride}::integer)`),
  );
}

// ---------------------------------------------------------------------------------------------------
// The organization (a signed-in member; the Organization Admin for the plan view)
// ---------------------------------------------------------------------------------------------------

/** What the Organization Admin sees (read-only). */
export interface OrganizationPlan {
  /** False: on no plan — every feature, no limits. */
  readonly hasPlan: boolean;
  readonly planName: string | null;
  readonly planDescription: string | null;
  readonly status: TenantStatus;
  readonly trialEndsAt: Date | null;
  readonly maxPeople: number | null;
  readonly peopleUsed: number;
  readonly maxStorageGb: number | null;
  readonly storageUsedBytes: number;
  readonly features: readonly PlanFeature[];
}

/** The caller's organization's plan (also while it is suspended: the paused admin). Throws NOT_ALLOWED. */
export async function getOrganizationPlan(tx: ClaimsTx): Promise<OrganizationPlan> {
  const rows = await run(() =>
    tx.execute(sql`
      select has_plan, plan_name, plan_description, status, trial_ends_at, max_people, people_used,
             max_storage_gb, storage_used_bytes, features
      from private.organization_plan()`),
  );
  const r = rows[0];
  if (!r) throw new PlanError('NOT_ALLOWED');
  return {
    hasPlan: r.has_plan === true,
    planName: (r.plan_name as string | null) ?? null,
    planDescription: (r.plan_description as string | null) ?? null,
    status: status(r.status),
    trialEndsAt: r.trial_ends_at ? toDate(r.trial_ends_at as Date | string) : null,
    maxPeople: intOrNull(r.max_people),
    peopleUsed: Number(r.people_used),
    maxStorageGb: intOrNull(r.max_storage_gb),
    storageUsedBytes: Number(r.storage_used_bytes),
    features: features(r.features),
  };
}

/** SQLSTATE undefined_function: the database is not migrated yet (the app deployed first). */
const UNDEFINED_FUNCTION = '42883';

/**
 * The features the caller's organization has (every feature when it is on no plan) — menus, pages and the
 * grant loader. Every feature while the function does not exist yet (expand-first: the app may deploy before
 * the database); none for a session the database does not serve (fails closed, as the grants then are). In a
 * savepoint so the caller's transaction stays usable.
 */
export async function getOrganizationFeatures(tx: ClaimsTx): Promise<readonly PlanFeature[]> {
  try {
    return await tx.transaction(async (savepoint) => {
      const rows = await savepoint.execute<{ features: unknown }>(
        sql`select private.current_tenant_features() as features`,
      );
      return features(rows[0]?.features);
    });
  } catch (error) {
    const code = pgError(error)?.code;
    if (code === UNDEFINED_FUNCTION) return PLAN_FEATURES;
    if (code === '42501') return [];
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------------------------------

/** Suspends the organizations whose trial has ended (audited); returns how many. Worker platform task. */
export async function expireTrials(tx: ClaimsTx): Promise<number> {
  const rows = await tx.execute<{ ended: number | string }>(
    sql`select private.expire_trials() as ended`,
  );
  return Number(rows[0]?.ended ?? 0);
}
