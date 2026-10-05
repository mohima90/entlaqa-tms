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
}));
vi.mock('@jadarat/platform-identity/next', () => identity);
vi.mock('@jadarat/platform-db', () => db);

const { createSessionDraft } = await import('./sessions');

const input = {
  courseId: '55555555-5555-4555-8555-555555555555',
  titleAr: 'مهارات القيادة',
  deliveryType: 'classroom' as const,
  startsAt: '2026-10-05T09:00:00+03:00',
  endsAt: '2026-10-05T15:00:00+03:00',
  capacity: 20,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('createSessionDraft (server action)', () => {
  it('is denied (403) for a signed-in member without a role that grants it; nothing is written', async () => {
    identity.getVerifiedClaims.mockResolvedValue(claims);
    const result = await createSessionDraft(input);
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
    const result = await createSessionDraft(input);
    expect(!result.ok && result.error.status).toBe(401);
    expect(db.withUserTx).not.toHaveBeenCalled();
  });

  it('validates untrusted input (422) before any database work', async () => {
    identity.getVerifiedClaims.mockResolvedValue(claims);
    const result = await createSessionDraft({ ...input, courseId: '1 or 1=1' });
    expect(!result.ok && result.error).toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(db.withUserTx).not.toHaveBeenCalled();
  });
});

describe('createSessionDraft definition (positive path with a fake runtime)', () => {
  it('drafts the session when a grant covers the course, and records an audit event', async () => {
    const { createDefineAction } = await import('@jadarat/platform-rbac');
    const { sessionDraftActionDefinition } = await import('./session-draft.definition');
    if (!claims.ok) throw new Error('fixture');
    const audits: unknown[] = [];
    const resolved: unknown[] = [];
    const action = createDefineAction<object>({
      getClaims: () => Promise.resolve(claims),
      withUserTx: (_c, fn) => fn({}),
      loadGrants: () =>
        Promise.resolve([
          {
            permission: 'tms.session.create',
            scope: { type: 'org_units', orgUnitIds: ['ou-1'], includeDescendants: true },
          },
        ]),
      resolveResource: (_tx, ref) => {
        resolved.push(ref);
        return Promise.resolve({
          type: ref.type,
          id: ref.id,
          tenantId: '22222222-2222-4222-8222-222222222222',
          orgUnitId: 'ou-2',
          orgUnitAncestorIds: ['ou-1'],
        });
      },
      writeAudit: (_tx, _actor, record) => {
        audits.push(record);
        return Promise.resolve();
      },
      logError: () => undefined,
    })(sessionDraftActionDefinition<object>());

    const result = await action(input);
    expect(result.ok && result.value).toMatchObject({ status: 'draft', durationMinutes: 360 });
    expect(resolved).toEqual([{ type: 'course', id: input.courseId }]);
    expect(audits).toEqual([
      {
        action: 'tms.session.draft_created',
        entityType: 'course',
        entityId: input.courseId,
        data: { deliveryType: 'classroom' },
      },
    ]);
  });
});
