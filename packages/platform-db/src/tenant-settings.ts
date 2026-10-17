import 'server-only';
import { sql } from 'drizzle-orm';
import { pgError } from './pg-error';
import type { UserTx } from './with-user-tx';

/**
 * The organization's profile and regional settings (FR-ADM-02, FR-SCH-07; T-M2-22; migrations
 * 20261017090000–20261017090200): display names on platform.tenants, everything else on
 * platform.tenant_settings. The database decides who may change them (the Organization Admin; no
 * authenticator code since the PO decision of 14 Oct 2026) and every rule; these are its request-path calls.
 */

export const TENANT_DATE_DISPLAYS = ['gregorian', 'hijri', 'dual'] as const;
export type TenantDateDisplay = (typeof TENANT_DATE_DISPLAYS)[number];

/** What the Organization Admin edits on the profile page. Times are local wall-clock "HH:MM". */
export interface OrganizationProfile {
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly industry: string | null;
  readonly countryCode: string | null;
  readonly currencyCode: string;
  readonly timeZone: string;
  readonly fiscalYearStartMonth: number;
  readonly defaultLocale: 'ar' | 'en';
  readonly dateDisplay: TenantDateDisplay;
  /** 0 = Sunday … 6 = Saturday, sorted. */
  readonly workingDays: readonly number[];
  readonly workStartsAt: string;
  readonly workEndsAt: string;
}

export interface OrganizationProfileRecord extends OrganizationProfile {
  readonly updatedAt: Date;
  /** Who saved the profile last (null: never saved since the organization was created). */
  readonly updatedBy: { readonly nameAr: string; readonly nameEn: string | null } | null;
  /** Optimistic concurrency token. */
  readonly version: number;
}

type Row = Record<string, unknown>;

/** "08:00:00" (PostgreSQL time) → "08:00". */
function hhmm(value: unknown): string {
  return String(value).slice(0, 5);
}

/** smallint[] as postgres.js returns it (numbers), or its text form "{0,1}". */
function days(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  const text = typeof value === 'string' ? value.replace(/[{}\s]/g, '') : '';
  return text ? text.split(',').map(Number) : [];
}

function profileOf(row: Row): OrganizationProfile {
  return {
    nameAr: String(row.name_ar),
    nameEn: (row.name_en as string | null) ?? null,
    industry: (row.industry as string | null) ?? null,
    countryCode: (row.country_code as string | null) ?? null,
    currencyCode: String(row.currency_code),
    timeZone: String(row.timezone),
    fiscalYearStartMonth: Number(row.fiscal_year_start_month),
    defaultLocale: row.default_locale === 'ar' ? 'ar' : 'en',
    dateDisplay: (TENANT_DATE_DISPLAYS as readonly unknown[]).includes(row.date_display)
      ? (row.date_display as TenantDateDisplay)
      : 'gregorian',
    workingDays: days(row.working_days),
    workStartsAt: hhmm(row.work_starts_at),
    workEndsAt: hhmm(row.work_ends_at),
  };
}

const COLUMNS = sql`t.name_ar, t.name_en, s.industry, s.country_code, s.currency_code, s.timezone,
  s.fiscal_year_start_month, s.default_locale, s.date_display, s.working_days, s.work_starts_at, s.work_ends_at`;

/** The current organization's profile (RLS: only the claims' organization), or null. */
export async function getOrganizationProfile(
  tx: UserTx,
): Promise<OrganizationProfileRecord | null> {
  const [row] = await tx.execute(sql`
    select ${COLUMNS}, s.updated_at, s.version,
           e.display_name_ar as editor_name_ar, e.display_name_en as editor_name_en
    from platform.tenant_settings s
    join platform.tenants t on t.id = s.tenant_id
    left join platform.persons e on e.tenant_id = s.tenant_id and e.id = s.updated_by
    where s.tenant_id = (select private.current_tenant_id())`);
  if (!row) return null;
  const editor = row.editor_name_ar as string | null;
  return {
    ...profileOf(row),
    updatedAt: new Date(row.updated_at as string | Date),
    updatedBy: editor
      ? { nameAr: editor, nameEn: (row.editor_name_en as string | null) ?? null }
      : null,
    version: Number(row.version),
  };
}

/**
 * The organization's default currency (ISO 4217; FR-ADM-02 General settings) — for modules that show or
 * enter amounts (course costs, T-M3-03). Every member reads it (RLS: the claims' organization only); 'SAR'
 * (the database default) when no row is visible.
 */
export async function getTenantCurrencyCode(tx: UserTx): Promise<string> {
  const [row] = await tx.execute<{ currency_code: string }>(sql`
    select s.currency_code from platform.tenant_settings s
    where s.tenant_id = (select private.current_tenant_id())`);
  return row ? row.currency_code : 'SAR';
}

/** Values the caller only accepts when they are on offer (or already stored): codes and time zone. */
export type OfferedProfileField = 'countryCode' | 'currencyCode' | 'timeZone';

export type OrganizationProfileUpdate =
  | {
      readonly outcome: 'updated';
      readonly before: OrganizationProfile;
      readonly after: OrganizationProfile;
      /** The new concurrency token (the page saves again with it). */
      readonly version: number;
    }
  /** Nothing differs from what is stored: no write, the version stays (review L1). */
  | { readonly outcome: 'unchanged'; readonly version: number }
  /** A value that is neither on offer nor the stored one, or one the database refuses (time zone). */
  | { readonly outcome: 'invalid'; readonly field: OfferedProfileField }
  /** Someone saved it since the page was loaded (version), or this session may not change it. */
  | { readonly outcome: 'conflict' | 'refused' };

const OFFERED_FIELDS: readonly OfferedProfileField[] = ['countryCode', 'currencyCode', 'timeZone'];

/**
 * Saves the profile when it is still at `version` and differs from what is stored: the settings row (it
 * records who saved and when, and moves the version on), the display names when they changed. A country,
 * currency or time zone must be on offer (`accepts`) unless it is the stored one — a value saved earlier
 * stays accepted even when this runtime no longer lists it. The database lets only an Organization Admin
 * change either row (policies tenant_settings_update and tenants_update); any
 * refusal changes nothing — the caller's transaction is rolled back.
 */
export async function updateOrganizationProfile(
  tx: UserTx,
  profile: OrganizationProfile,
  version: number,
  accepts: (field: OfferedProfileField, value: string) => boolean = () => true,
): Promise<OrganizationProfileUpdate> {
  // Row locks that do not block foreign-key checks against the organization (review L2).
  const [current] = await tx.execute(sql`
    select ${COLUMNS}, s.version
    from platform.tenant_settings s
    join platform.tenants t on t.id = s.tenant_id
    where s.tenant_id = (select private.current_tenant_id())
    for no key update of s, t`);
  if (!current) return { outcome: 'refused' };
  if (Number(current.version) !== version) return { outcome: 'conflict' };
  const before = profileOf(current);
  if (changedProfileFields(before, profile).length === 0) {
    return { outcome: 'unchanged', version };
  }
  for (const field of OFFERED_FIELDS) {
    const value = profile[field];
    if (value !== null && value !== before[field] && !accepts(field, value)) {
      return { outcome: 'invalid', field };
    }
  }
  const workingDays = `{${profile.workingDays.join(',')}}`;
  let settings: Record<string, unknown> | undefined;
  try {
    [settings] = await tx.execute(sql`
      update platform.tenant_settings
      set industry = ${profile.industry}, country_code = ${profile.countryCode},
          currency_code = ${profile.currencyCode}, timezone = ${profile.timeZone},
          fiscal_year_start_month = ${profile.fiscalYearStartMonth},
          default_locale = ${profile.defaultLocale}, date_display = ${profile.dateDisplay},
          working_days = ${workingDays}::smallint[],
          work_starts_at = ${profile.workStartsAt}::time, work_ends_at = ${profile.workEndsAt}::time
      where tenant_id = (select private.current_tenant_id()) and version = ${version}
      returning tenant_id`);
  } catch (error) {
    // A zone Intl knows but this PostgreSQL does not (the trigger's check): the field, not a fault.
    const pg = pgError(error);
    if (pg?.code === '23514' && pg.constraint === 'tenant_settings_timezone_check') {
      return { outcome: 'invalid', field: 'timeZone' };
    }
    throw error;
  }
  if (!settings) return { outcome: 'refused' };
  if (profile.nameAr !== before.nameAr || profile.nameEn !== before.nameEn) {
    const [names] = await tx.execute(sql`
      update platform.tenants set name_ar = ${profile.nameAr}, name_en = ${profile.nameEn}
      where id = (select private.current_tenant_id())
      returning id`);
    if (!names) return { outcome: 'refused' };
  }
  const [after] = await tx.execute(sql`
    select ${COLUMNS}, s.version
    from platform.tenant_settings s
    join platform.tenants t on t.id = s.tenant_id
    where s.tenant_id = (select private.current_tenant_id())`);
  if (!after) return { outcome: 'refused' };
  return { outcome: 'updated', before, after: profileOf(after), version: Number(after.version) };
}

/** The fields whose values differ (audit: before/after of these only). */
export function changedProfileFields(
  before: OrganizationProfile,
  after: OrganizationProfile,
): (keyof OrganizationProfile)[] {
  return (Object.keys(after) as (keyof OrganizationProfile)[]).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}
