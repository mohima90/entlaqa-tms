import { appError, err, ok } from '@jadarat/platform-core';
import {
  type OfferedProfileField,
  type OrganizationProfile,
  type OrganizationProfileRecord,
  type UserTx,
  changedProfileFields,
  getOrganizationProfile,
  updateOrganizationProfile,
} from '@jadarat/platform-db';
import {
  DATE_DISPLAYS,
  INDUSTRIES,
  canonicalTimeZone,
  ianaTimeZones,
  isoCountryCodes,
  isoCurrencyCodes,
} from '@jadarat/platform-i18n';
import { z } from 'zod';
import type { ActionDefinition, PermissionAccess } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { platformPermissions as p } from '../platform-permissions';

/**
 * Organization profile and regional settings (approved screen «بيانات المنشأة» / "Organization profile",
 * PO 14 Oct 2026; FR-ADM-02, FR-SCH-07, BR-ADM-3; T-M2-22). The database enforces who may change them and
 * every rule (platform.tenant_settings, the tenants_update policy); these definitions authorize, validate
 * and audit.
 *
 *   - The page: only members who may change the profile — `platform.tenant.manage` organization-wide, i.e.
 *     the Organization Admin (PO, 14 Oct 2026: HR Manager, Learner and Auditor are refused). At AAL1 the
 *     admin sees the form and is asked for an authenticator code first (step-up), as on the security page.
 *   - Saving: `platform.tenant.manage` — high risk, AAL2 (ADR 0003 §3: the registry's risk decides; the
 *     permission also covers branding and domains; PO decision D-IAM-01: a code even when MFA is off),
 *     getUser() before the change, a code from the last 15 minutes. Audited with the changed fields' values
 *     before and after (BR-IAM-3 style); organization names and settings are not personal data.
 *   - Every member's pages read the date display, time zone and default language through getCurrentTenant
 *     (platform-db), not through this page.
 */

/** Display names: required, trimmed, at most 80 characters (the screen). */
export const ORGANIZATION_NAME_MAX = 80;

/**
 * Bidirectional embedding, override and isolate marks (U+202A–U+202E, U+2066–U+2069): they can reorder
 * how a name is shown next to other text (review L3, ADR 0007 §3). Joiners (ZWNJ U+200C, ZWJ U+200D),
 * which Arabic and Persian spelling needs, stay allowed. The database refuses them too
 * (tenants_names_bidi_check).
 */
export const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/u;

const name = z
  .string()
  .normalize('NFC')
  .trim()
  .min(1)
  .max(ORGANIZATION_NAME_MAX)
  // No control characters (as provisioning) and no bidi controls.
  .refine((value) => !/\p{Cc}/u.test(value) && !BIDI_CONTROLS.test(value));

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * The profile as saved. Unknown fields are refused. Country, currency and time zone are checked for their
 * shape here; the handler accepts them when this server offers them OR when they are the stored value
 * (a value saved earlier never blocks a save — review M1).
 */
export const OrganizationProfileInput = z
  .strictObject({
    version: z.int().min(1),
    nameEn: name,
    nameAr: name,
    industry: z.enum(INDUSTRIES),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    timeZone: z
      .string()
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/),
    fiscalYearStartMonth: z.int().min(1).max(12),
    defaultLocale: z.enum(['ar', 'en']),
    dateDisplay: z.enum(DATE_DISPLAYS),
    workingDays: z
      .array(z.int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length),
    workStartsAt: clock,
    workEndsAt: clock,
  })
  .superRefine((value, ctx) => {
    // "HH:MM" strings compare like times (only when both are valid: otherwise their own error says so).
    const valid = (time: string) => clock.safeParse(time).success;
    if (
      valid(value.workStartsAt) &&
      valid(value.workEndsAt) &&
      value.workEndsAt <= value.workStartsAt
    ) {
      ctx.addIssue({ code: 'custom', path: ['workEndsAt'], message: 'before_start' });
    }
  });

export interface OrganizationProfilePageView {
  readonly profile: OrganizationProfileRecord;
  /** allowed · step_up_required (an Organization Admin at AAL1: a code first). Never denied here. */
  readonly editAccess: Exclude<PermissionAccess, 'denied'>;
}

export function organizationProfileQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  OrganizationProfilePageView,
  UserTx
> {
  return {
    // Organization-wide read first (Organization Admin, Auditor) — then the manage permission decides.
    permission: p['platform.tenant.read'],
    input: z.strictObject({}),
    handler: async ({ ctx }) => {
      const editAccess = ctx.access(p['platform.tenant.manage'], 'tenant');
      // Deny by default: the page is for members who may change the profile (not the Auditor).
      if (editAccess === 'denied') return err(appError('FORBIDDEN'));
      const profile = await getOrganizationProfile(ctx.tx);
      if (!profile) return err(appError('NOT_FOUND'));
      return ok({ profile, editAccess });
    },
  };
}

export interface OrganizationProfileSaved {
  readonly tenantId: string;
  /** The profile's version now: the page saves again with it (review L8). */
  readonly version: number;
  readonly changed: readonly (keyof OrganizationProfile)[];
  readonly before: Partial<OrganizationProfile>;
  readonly after: Partial<OrganizationProfile>;
}

function pick(
  profile: OrganizationProfile,
  keys: readonly (keyof OrganizationProfile)[],
): Partial<OrganizationProfile> {
  return Object.fromEntries(keys.map((key) => [key, profile[key]]));
}

/** What this server offers (built from its ICU data, as the page's choices). */
const OFFERED: Readonly<Record<OfferedProfileField, () => readonly string[]>> = {
  countryCode: isoCountryCodes,
  currencyCode: isoCurrencyCodes,
  timeZone: ianaTimeZones,
};

export function updateOrganizationProfileActionDefinition(): ActionDefinition<
  typeof OrganizationProfileInput,
  OrganizationProfileSaved,
  UserTx
> {
  return {
    permission: p['platform.tenant.manage'],
    input: OrganizationProfileInput,
    handler: async ({ ctx, input }) => {
      const { version, ...profile } = input;
      const saved = await updateOrganizationProfile(
        ctx.tx,
        {
          ...profile,
          timeZone: canonicalTimeZone(profile.timeZone),
          // Stored sorted (the database sorts too).
          workingDays: [...profile.workingDays].sort((a, b) => a - b),
        },
        version,
        (field, value) => OFFERED[field]().includes(value),
      );
      switch (saved.outcome) {
        case 'unchanged':
          // Nothing to write (review L1): no new version, no audit record.
          return ok({
            tenantId: ctx.claims.tenant_id,
            version: saved.version,
            changed: [],
            before: {},
            after: {},
          });
        case 'invalid':
          return err(
            appError('VALIDATION_FAILED', {
              fieldErrors: [{ path: saved.field, code: 'INVALID' }],
            }),
          );
        case 'conflict':
          return err(appError('CONFLICT_VERSION'));
        case 'refused':
          return err(appError('FORBIDDEN'));
        case 'updated': {
          const changed = changedProfileFields(saved.before, saved.after);
          return ok({
            tenantId: ctx.claims.tenant_id,
            version: saved.version,
            changed,
            before: pick(saved.before, changed),
            after: pick(saved.after, changed),
          });
        }
      }
    },
    // Organization settings changes are audited with the values before and after (BR-IAM-3 style).
    audit: (_input, output) =>
      output.changed.length === 0
        ? null
        : {
            action: 'platform.tenant.profile_changed',
            entityType: 'tenant',
            entityId: output.tenantId,
            data: { changed: output.changed, before: output.before, after: output.after },
          },
  };
}
