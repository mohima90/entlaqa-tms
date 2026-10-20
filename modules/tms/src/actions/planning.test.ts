/**
 * The exported planning server actions, wired to the real defineAction pipeline and default runtime; only
 * the request cookies (platform-identity/next) and the database (platform-db) are replaced. A member whose
 * roles grant no planning permission is refused (403) before anything is read or written.
 */
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { afterEach, describe, expect, it, vi } from 'vitest';

const claims = brandVerifiedClaims({
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'authenticated',
  aal: 'aal1',
  session_id: '33333333-3333-4333-8333-333333333333',
  tenant_id: '22222222-2222-4222-8222-222222222222',
  person_id: '44444444-4444-4444-8444-444444444444',
});

const identity = vi.hoisted(() => ({
  getVerifiedClaims: vi.fn(),
  getVerifiedClaimsStrict: vi.fn(),
}));
const db = vi.hoisted(() => ({
  withUserTx: vi.fn((_claims: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  // The member is the Organization Admin: no planning permission (BR-IAM-4).
  loadMemberAuthorizationFacts: vi.fn(() =>
    Promise.resolve({
      roles: [{ roleCode: 'tenant_admin' }],
      headedDepartmentIds: [],
      customRoles: [],
    }),
  ),
  listOrgStructure: vi.fn(),
  getMemberOptionsByIds: vi.fn(),
  searchMemberOptions: vi.fn(),
  MEMBER_SEARCH: { minLength: 2, maxLength: 100, limit: 50 },
  getOrganizationProfile: vi.fn(),
  schema: {},
  MFA_MODES: ['off', 'optional', 'required_all', 'required_roles'],
  BRAND_IMAGE_KINDS: ['logo', 'favicon', 'sign_in_image'],
  SECURITY_LIMITS: {
    mfaGraceDays: { min: 0, max: 30 },
    passwordMinLength: { min: 12, max: 36 },
    lockoutThreshold: { min: 3, max: 5 },
    lockoutMinutes: { min: 15, max: 60 },
    sessionIdleMinutes: { min: 5, max: 480 },
    sessionMaxHours: { min: 1, max: 24 },
    sessionMaxDevices: { min: 1, max: 10 },
  },
  loadSessionFacts: vi.fn(() => Promise.resolve({ active: true, aal2: false })),
  isPassiveRead: vi.fn(() => false),
}));
vi.mock('@jadarat/platform-identity/next', () => identity);
vi.mock('@jadarat/platform-db', () => db);

const actions = await import('./planning');
const { listNeedsFormOptions } = await import('../planning/needs-forms');

afterEach(() => {
  vi.clearAllMocks();
});

const CYCLE = '55555555-5555-4555-8555-555555555555';

describe('planning server actions (deny by default)', () => {
  it('refuses the Organization Admin every planning change (403); nothing is read', async () => {
    identity.getVerifiedClaims.mockResolvedValue(claims);
    const calls = [
      () =>
        actions.createPlanCycleAction({
          nameAr: 'خطة',
          nameEn: 'Plan',
          periodStart: '2027-01-01',
          periodEnd: '2027-12-31',
          deadline: '2026-11-30',
        }),
      () =>
        actions.updatePlanCycleBasicsAction({
          id: CYCLE,
          version: 1,
          nameAr: 'خطة',
          nameEn: 'Plan',
          periodStart: '2027-01-01',
          periodEnd: '2027-12-31',
          deadline: '2026-11-30',
        }),
      () =>
        actions.savePlanCycleScopeAction({
          id: CYCLE,
          version: 1,
          departmentIds: [],
          branchIds: [],
        }),
      () => actions.savePlanCycleBudgetsAction({ id: CYCLE, version: 1, budgets: [] }),
      () =>
        actions.savePlanCycleStepsAction({
          id: CYCLE,
          version: 1,
          steps: [{ kind: 'department_heads', nameAr: 'ر', nameEn: 'H', approverPersonId: null }],
        }),
      () => actions.savePlanCycleRemindersAction({ id: CYCLE, version: 1, reminderDays: [7] }),
      () => actions.launchPlanCycleAction({ id: CYCLE, version: 1 }),
      () =>
        actions.extendPlanCycleDeadlineAction({ id: CYCLE, version: 1, deadline: '2026-12-01' }),
      () => actions.deletePlanCycleAction({ id: CYCLE, version: 1 }),
      () =>
        actions.savePlanningSettingsAction({
          reminderDays: [7],
          steps: [{ kind: 'department_heads', nameAr: 'ر', nameEn: 'H', approverPersonId: null }],
        }),
    ];
    for (const call of calls) {
      const result = await call();
      expect(!result.ok && result.error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    }
    expect(db.listOrgStructure).not.toHaveBeenCalled();
    expect(db.getMemberOptionsByIds).not.toHaveBeenCalled();
    // Medium-risk permission: local JWT verification, no getUser round-trip.
    expect(identity.getVerifiedClaimsStrict).not.toHaveBeenCalled();
  });

  it('returns 401 without a verified session and never opens a transaction', async () => {
    identity.getVerifiedClaims.mockResolvedValue({
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        status: 401,
        messageKey: 'errors.unauthenticated',
        expose: true,
      },
    });
    const result = await actions.launchPlanCycleAction({ id: CYCLE, version: 1 });
    expect(!result.ok && result.error.status).toBe(401);
    expect(db.withUserTx).not.toHaveBeenCalled();
  });
});

describe('needs forms of a cycle (T-M3-10 forms library)', () => {
  it('lists the organization\u2019s active forms as the database orders them (default first)', async () => {
    const execute = vi.fn().mockResolvedValue([
      { id: 'f1', name_ar: 'النموذج الافتراضي', name_en: 'Default form', is_default: true },
      { id: 'f2', name_ar: 'نموذج', name_en: 'Other form', is_default: false },
    ]);
    expect(await listNeedsFormOptions({ execute } as never)).toEqual([
      { id: 'f1', name: { ar: 'النموذج الافتراضي', en: 'Default form' }, isDefault: true },
      { id: 'f2', name: { ar: 'نموذج', en: 'Other form' }, isDefault: false },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
