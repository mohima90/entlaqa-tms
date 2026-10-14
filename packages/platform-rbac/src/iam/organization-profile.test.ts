import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grant } from '../authorize';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { MEMBER_GRANTS } from '../member-permissions';
import { grantsForAssignments } from '../role-grants';
import type { SystemRoleCode } from '../system-roles';
import {
  OrganizationProfileInput,
  organizationProfileQueryDefinition,
  updateOrganizationProfileActionDefinition,
} from './organization-profile';

const db = vi.hoisted(() => ({
  TENANT_DATE_DISPLAYS: ['gregorian', 'hijri', 'dual'] as const,
  changedProfileFields: (before: Record<string, unknown>, after: Record<string, unknown>) =>
    Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])),
  getOrganizationProfile: vi.fn(),
  updateOrganizationProfile: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const SESSION = '55555555-5555-4555-8555-555555555555';

/** `codeAgeSeconds`: how long ago the session passed its authenticator code (aal2). */
function runtime(grants: readonly Grant[], aal: 'aal1' | 'aal2' = 'aal1', codeAgeSeconds = 0) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const getClaims = vi.fn(() => {
    const r = brandVerifiedClaims({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'authenticated',
      aal,
      ...(aal === 'aal2'
        ? { amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - codeAgeSeconds }] }
        : {}),
      session_id: SESSION,
      tenant_id: TENANT,
      person_id: ME,
    });
    if (!r.ok) throw new Error('fixture');
    return Promise.resolve(ok(r.value));
  });
  const rt: ActionRuntime<UserTx> = {
    getClaims,
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: aal === 'aal2' }),
    loadGrants: () => Promise.resolve([...grants, ...MEMBER_GRANTS]),
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit, getClaims };
}

const forRoles = (...roles: SystemRoleCode[]) =>
  grantsForAssignments(
    roles.map((roleCode) => ({ roleCode })),
    { headedDepartmentIds: [] },
  );

const profile = {
  nameAr: 'شركة الراية',
  nameEn: 'Al Raya Company',
  industry: 'banking_financial' as const,
  countryCode: 'SA',
  currencyCode: 'SAR',
  timeZone: 'Asia/Riyadh',
  fiscalYearStartMonth: 1,
  defaultLocale: 'en' as const,
  dateDisplay: 'dual' as const,
  workingDays: [0, 1, 2, 3, 4],
  workStartsAt: '08:00',
  workEndsAt: '16:00',
};
const record = { ...profile, updatedAt: new Date(0), updatedBy: null, version: 3 };
const input = { ...profile, version: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  db.getOrganizationProfile.mockResolvedValue(record);
  db.updateOrganizationProfile.mockImplementation((_tx: unknown, after: typeof profile) =>
    Promise.resolve({ outcome: 'updated', before: profile, after, version: 4 }),
  );
});

describe('organization profile page (T-M2-22)', () => {
  it('the Organization Admin opens and edits it at AAL1 (no authenticator code, PO 14 Oct 2026)', async () => {
    for (const aal of ['aal1', 'aal2'] as const) {
      const query = createDefineQuery(runtime(forRoles('tenant_admin'), aal).rt)(
        organizationProfileQueryDefinition(),
      );
      expect(await query({})).toEqual({
        ok: true,
        value: { profile: record, editAccess: 'allowed' },
      });
    }
  });

  it('the Auditor reads it, read only (BRD Appendix B; PO 14 Oct 2026)', async () => {
    for (const aal of ['aal1', 'aal2'] as const) {
      const query = createDefineQuery(runtime(forRoles('auditor'), aal).rt)(
        organizationProfileQueryDefinition(),
      );
      expect(await query({})).toEqual({
        ok: true,
        value: { profile: record, editAccess: 'denied' },
      });
    }
  });

  it.each([['hr_manager'], ['learner'], ['training_manager'], ['line_manager']] as const)(
    'refuses the %s (no organization-wide settings read), also at AAL2',
    async (role) => {
      for (const aal of ['aal1', 'aal2'] as const) {
        const query = createDefineQuery(runtime(forRoles(role), aal).rt)(
          organizationProfileQueryDefinition(),
        );
        const result = await query({});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
      }
      expect(db.getOrganizationProfile).not.toHaveBeenCalled();
    },
  );

  it('NOT_FOUND without settings', async () => {
    db.getOrganizationProfile.mockResolvedValue(null);
    const query = createDefineQuery(runtime(forRoles('tenant_admin')).rt)(
      organizationProfileQueryDefinition(),
    );
    const result = await query({});
    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
  });
});

describe('saving the organization profile (T-M2-22)', () => {
  it('the Organization Admin at AAL1 saves; audited with the changed values before and after', async () => {
    const { rt, writeAudit, getClaims } = runtime(forRoles('tenant_admin'));
    const save = createDefineAction(rt)(updateOrganizationProfileActionDefinition());
    const result = await save({
      ...input,
      nameEn: '  Al Raya Group  ',
      workingDays: [5, 1, 2, 3, 4],
      dateDisplay: 'hijri',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        tenantId: TENANT,
        version: 4,
        changed: ['nameEn', 'dateDisplay', 'workingDays'],
        before: { nameEn: 'Al Raya Company', dateDisplay: 'dual', workingDays: [0, 1, 2, 3, 4] },
        after: { nameEn: 'Al Raya Group', dateDisplay: 'hijri', workingDays: [1, 2, 3, 4, 5] },
      },
    });
    // Trimmed names, sorted days, the page's version; strict session check (high risk).
    expect(db.updateOrganizationProfile).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ nameEn: 'Al Raya Group', workingDays: [1, 2, 3, 4, 5] }),
      3,
      expect.any(Function),
    );
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.tenant.profile_changed',
      entityType: 'tenant',
      entityId: TENANT,
      data: {
        changed: ['nameEn', 'dateDisplay', 'workingDays'],
        before: { nameEn: 'Al Raya Company', dateDisplay: 'dual', workingDays: [0, 1, 2, 3, 4] },
        after: { nameEn: 'Al Raya Group', dateDisplay: 'hijri', workingDays: [1, 2, 3, 4, 5] },
      },
    });
  });

  it('nothing changed: no write, the same version, no audit record (review L1)', async () => {
    db.updateOrganizationProfile.mockResolvedValueOnce({ outcome: 'unchanged', version: 3 });
    const { rt, writeAudit } = runtime(forRoles('tenant_admin'), 'aal2');
    const result = await createDefineAction(rt)(updateOrganizationProfileActionDefinition())(input);
    expect(result).toEqual({
      ok: true,
      value: { tenantId: TENANT, version: 3, changed: [], before: {}, after: {} },
    });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('accepts only offered codes and canonical zones; a refused zone is a field error (review M1)', async () => {
    const { rt } = runtime(forRoles('tenant_admin'), 'aal2');
    const save = createDefineAction(rt)(updateOrganizationProfileActionDefinition());
    await save({ ...input, timeZone: 'Asia/Calcutta' });
    const [, sent, , accepts] = db.updateOrganizationProfile.mock.calls[0] as [
      unknown,
      { timeZone: string },
      number,
      (field: string, value: string) => boolean,
    ];
    expect(sent.timeZone).toBe('Asia/Kolkata');
    expect(accepts('timeZone', 'Asia/Kolkata')).toBe(true);
    expect(accepts('timeZone', 'Asia/Calcutta')).toBe(false);
    expect(accepts('countryCode', 'SA')).toBe(true);
    expect(accepts('countryCode', 'EU')).toBe(false);
    expect(accepts('currencyCode', 'XAU')).toBe(false);
    db.updateOrganizationProfile.mockResolvedValueOnce({ outcome: 'invalid', field: 'timeZone' });
    expect(await save({ ...input, timeZone: 'Asia/Dubai' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: [{ path: 'timeZone', code: 'INVALID' }] },
    });
  });

  it('never asks for an authenticator code: a code older than 15 minutes saves too', async () => {
    const { rt } = runtime(forRoles('tenant_admin'), 'aal2', 16 * 60);
    const result = await createDefineAction(rt)(updateOrganizationProfileActionDefinition())(input);
    expect(result.ok).toBe(true);
    expect(db.updateOrganizationProfile).toHaveBeenCalledOnce();
  });

  it.each([['hr_manager'], ['learner'], ['auditor'], ['finance_manager']] as const)(
    'refuses the %s at AAL1 and AAL2 (deny by default)',
    async (role) => {
      for (const aal of ['aal1', 'aal2'] as const) {
        const { rt, writeAudit } = runtime(forRoles(role), aal);
        const result = await createDefineAction(rt)(updateOrganizationProfileActionDefinition())(
          input,
        );
        expect(!result.ok && result.error.code, aal).toBe('FORBIDDEN');
        expect(writeAudit).not.toHaveBeenCalled();
      }
      expect(db.updateOrganizationProfile).not.toHaveBeenCalled();
    },
  );

  it('a stale version is a conflict; a refused write is forbidden', async () => {
    const { rt } = runtime(forRoles('tenant_admin'), 'aal2');
    const save = createDefineAction(rt)(updateOrganizationProfileActionDefinition());
    db.updateOrganizationProfile.mockResolvedValueOnce({ outcome: 'conflict' });
    expect(await save(input)).toMatchObject({ ok: false, error: { code: 'CONFLICT_VERSION' } });
    db.updateOrganizationProfile.mockResolvedValueOnce({ outcome: 'refused' });
    expect(await save(input)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('the profile input (validation)', () => {
  const fields = (value: unknown) => {
    const parsed = OrganizationProfileInput.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
  };

  it('accepts the profile and trims the names', () => {
    const parsed = OrganizationProfileInput.parse({ ...input, nameAr: ' شركة الراية ' });
    expect(parsed.nameAr).toBe('شركة الراية');
    expect(
      fields({ ...input, defaultLocale: 'ar', dateDisplay: 'gregorian', workingDays: [6] }),
    ).toEqual([]);
  });

  it('requires both names, at most 80 characters, no control characters', () => {
    expect(fields({ ...input, nameEn: '   ' })).toEqual(['nameEn']);
    expect(fields({ ...input, nameAr: '' })).toEqual(['nameAr']);
    expect(fields({ ...input, nameAr: 'ن'.repeat(81) })).toEqual(['nameAr']);
    expect(fields({ ...input, nameEn: 'x'.repeat(80) })).toEqual([]);
    expect(fields({ ...input, nameEn: 'Al\u0000Raya' })).toEqual(['nameEn']);
  });

  it('refuses bidi controls in names, keeps joiners, normalizes to NFC (review L3)', () => {
    for (const mark of [
      '\u202A',
      '\u202B',
      '\u202C',
      '\u202D',
      '\u202E',
      '\u2066',
      '\u2067',
      '\u2068',
      '\u2069',
    ]) {
      expect(fields({ ...input, nameEn: `Al ${mark}Raya` })).toEqual(['nameEn']);
    }
    expect(fields({ ...input, nameAr: 'می\u200Cخواهم و\u200Dشركة' })).toEqual([]);
    expect(OrganizationProfileInput.parse({ ...input, nameEn: 'Cafe\u0301' }).nameEn).toBe(
      'Caf\u00e9',
    );
  });

  it('accepts only listed codes', () => {
    expect(fields({ ...input, industry: 'mining' })).toEqual(['industry']);
    // Shapes here; whether a code or zone is on offer is the handler's check (above).
    expect(fields({ ...input, countryCode: 'sa' })).toEqual(['countryCode']);
    expect(fields({ ...input, countryCode: 'SAU' })).toEqual(['countryCode']);
    expect(fields({ ...input, currencyCode: 'SR' })).toEqual(['currencyCode']);
    expect(fields({ ...input, timeZone: 'Asia/Riyadh; drop table x' })).toEqual(['timeZone']);
    expect(fields({ ...input, timeZone: 'America/Argentina/Buenos_Aires' })).toEqual([]);
    expect(fields({ ...input, defaultLocale: 'fr' })).toEqual(['defaultLocale']);
    expect(fields({ ...input, dateDisplay: 'julian' })).toEqual(['dateDisplay']);
    expect(fields({ ...input, fiscalYearStartMonth: 13 })).toEqual(['fiscalYearStartMonth']);
    expect(fields({ ...input, fiscalYearStartMonth: 0 })).toEqual(['fiscalYearStartMonth']);
  });

  it('a working week of one to seven different days, hours in HH:MM with the end after the start', () => {
    expect(fields({ ...input, workingDays: [] })).toEqual(['workingDays']);
    expect(fields({ ...input, workingDays: [1, 1] })).toEqual(['workingDays']);
    expect(fields({ ...input, workingDays: [7] })).toEqual(['workingDays.0']);
    expect(fields({ ...input, workStartsAt: '8:00' })).toEqual(['workStartsAt']);
    expect(fields({ ...input, workEndsAt: '24:00' })).toEqual(['workEndsAt']);
    expect(fields({ ...input, workEndsAt: '08:00' })).toEqual(['workEndsAt']);
    expect(fields({ ...input, workStartsAt: '17:00' })).toEqual(['workEndsAt']);
  });

  it('refuses unknown fields and a missing version', () => {
    expect(fields({ ...input, tenantId: TENANT })).toEqual(['']);
    expect(fields({ ...input, version: 0 })).toEqual(['version']);
  });
});
