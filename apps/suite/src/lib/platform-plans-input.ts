import { hasVisibleText } from '@jadarat/platform-i18n';
import { z } from 'zod';

/**
 * Inputs of the console's plan actions (apps/suite/src/auth/platform-plans.ts; WP-ADM-06). Strict: unknown
 * fields are refused. The database validates everything again (private.platform_save_plan,
 * private.platform_set_tenant_plan). Field-error codes only (never values) reach the client.
 */

// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The product features a plan can include (private.plan_feature_codes). */
export const PLAN_FEATURE_CODES = [
  'planning',
  'needs_forms',
  'courses',
  'bulk_import',
  'branding',
  'email_integration',
] as const;

/** A limit: empty → no limit. */
const limit = (max: number) => z.int().min(1).max(max).nullable();

export const PlanFormInput = z.strictObject({
  planId: z.uuid().nullable(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => !CONTROL.test(value) && hasVisibleText(value), { message: 'name' }),
  description: z
    .string()
    .trim()
    .max(200)
    .refine((value) => !CONTROL.test(value), { message: 'description' })
    .transform((value) => (value === '' ? null : value)),
  maxPeople: limit(1_000_000),
  maxStorageGb: limit(100_000),
  features: z.array(z.enum(PLAN_FEATURE_CODES)).max(PLAN_FEATURE_CODES.length),
  version: z.int().min(1).nullable(),
});

export const TENANT_STATUS_CODES = ['trial', 'active', 'suspended', 'cancelled'] as const;

export const TenantPlanFormInput = z
  .strictObject({
    tenantId: z.uuid(),
    planId: z.uuid().nullable(),
    status: z.enum(TENANT_STATUS_CODES),
    /** A date (YYYY-MM-DD): the trial ends at the end of that day, Riyadh time. Only during a trial. */
    trialEndsOn: z.iso.date().nullable(),
    maxPeopleOverride: limit(1_000_000),
    maxStorageGbOverride: limit(100_000),
  })
  .superRefine((value, ctx) => {
    if ((value.status === 'trial') !== (value.trialEndsOn !== null)) {
      ctx.addIssue({ code: 'custom', path: ['trialEndsOn'], message: 'trial' });
    }
  })
  .transform(({ trialEndsOn, ...rest }) => ({
    ...rest,
    // The end of the chosen day in Riyadh (UTC+3, no daylight saving).
    trialEndsAt: trialEndsOn === null ? null : new Date(`${trialEndsOn}T23:59:59+03:00`),
  }));
