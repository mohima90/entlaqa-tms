/**
 * The exported server action, wired to the real defineAction pipeline and default runtime; only the
 * request cookies (platform-identity/next) and the database (platform-db) are replaced.
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
  // The member holds no role (T-M2-03: grants come from role assignments).
  loadMemberAuthorizationFacts: vi.fn(() =>
    Promise.resolve({ roles: [], headedDepartmentIds: [] }),
  ),
  schema: {},
  // Read when @jadarat/platform-rbac loads (its security settings schema, T-M2-10).
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
  // The session may act in its organization (T-M2-10, review L1).
  loadSessionFacts: vi.fn(() => Promise.resolve({ active: true, aal2: false })),
  // Read by the default runtime's withUserTx (passive reads, T-M2-12 integration review L1).
  isPassiveRead: vi.fn(() => false),
}));
vi.mock('@jadarat/platform-identity/next', () => identity);
vi.mock('@jadarat/platform-db', () => db);

const { createDraftSessionsAction, deleteDraftSessionAction, linkLineCourseAction } =
  await import('./sessions');

const input = {
  lineId: '55555555-5555-4555-8555-555555555555',
  sessions: [
    {
      month: '2027-01',
      branchId: null,
      seats: 16,
      personIds: ['66666666-6666-4666-8666-666666666666'],
    },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('createDraftSessionsAction (server action, WP-LD-04)', () => {
  it('is denied (403) for a signed-in member without tms.session.manage; nothing is written', async () => {
    identity.getVerifiedClaims.mockResolvedValue(claims);
    const result = await createDraftSessionsAction(input);
    expect(!result.ok && result.error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    // Medium-risk permission: local JWT verification (getClaims), no getUser round-trip.
    expect(identity.getVerifiedClaims).toHaveBeenCalledOnce();
    expect(identity.getVerifiedClaimsStrict).not.toHaveBeenCalled();
    expect(db.withUserTx).toHaveBeenCalledOnce();
    expect(db.loadMemberAuthorizationFacts).toHaveBeenCalledOnce();
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
    const result = await createDraftSessionsAction(input);
    expect(!result.ok && result.error.status).toBe(401);
    expect(db.withUserTx).not.toHaveBeenCalled();
  });

  it('validates untrusted input (422) before any database work', async () => {
    identity.getVerifiedClaims.mockResolvedValue(claims);
    const session = { month: '2027-01', branchId: null, seats: 16, personIds: [] as string[] };
    const bads: unknown[] = [
      { ...input, lineId: '1 or 1=1' },
      { ...input, sessions: [] },
      { ...input, sessions: [{ ...session, month: '2027-13' }] },
      { ...input, sessions: [{ ...session, seats: 0 }] },
      {
        ...input,
        sessions: [
          {
            ...session,
            personIds: [
              '66666666-6666-4666-8666-666666666666',
              '66666666-6666-4666-8666-666666666666',
            ],
          },
        ],
      },
      { ...input, extra: true },
    ];
    for (const bad of bads) {
      const result = await createDraftSessionsAction(bad as typeof input);
      expect(!result.ok && result.error).toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    }
    expect(db.withUserTx).not.toHaveBeenCalled();
  });

  it('denies linking a course and deleting a draft without a role that grants them', async () => {
    identity.getVerifiedClaims.mockResolvedValue(claims);
    const linked = await linkLineCourseAction({
      lineId: input.lineId,
      lineVersion: 1,
      courseId: '77777777-7777-4777-8777-777777777777',
    });
    expect(!linked.ok && linked.error.code).toBe('FORBIDDEN');
    const deleted = await deleteDraftSessionAction({ sessionId: input.lineId, version: 1 });
    expect(!deleted.ok && deleted.error.code).toBe('FORBIDDEN');
  });
});
