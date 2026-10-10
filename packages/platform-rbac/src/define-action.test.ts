import {
  type AppError,
  type Result,
  appError,
  defineErrorCodes,
  err,
  ok,
} from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { Grant } from './authorize';
import {
  type ActionRuntime,
  DEFINE_ACTION_MARKER,
  createDefineAction,
  requiresStrictVerification,
} from './define-action';
import { definePermissions } from './permissions';

const label = { ar: 'اعتماد', en: 'Approve' };
const perms = definePermissions('tms', [
  {
    code: 'tms.enrollment.approve',
    label,
    description: label,
    risk: 'medium',
    requiresAal2: false,
  },
]);
const approve = perms['tms.enrollment.approve'];

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';
const PERSON = '33333333-3333-4333-8333-333333333333';
const ENROLLMENT = '44444444-4444-4444-8444-444444444444';

function claims(extra: Record<string, unknown> = { tenant_id: TENANT, person_id: PERSON }) {
  const r = brandVerifiedClaims({ sub: USER, role: 'authenticated', aal: 'aal1', ...extra });
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

interface FakeTx {
  readonly log: string[];
}

function runtime(over: Partial<ActionRuntime<FakeTx>> = {}) {
  const log: string[] = [];
  const audits: unknown[] = [];
  const rt: ActionRuntime<FakeTx> = {
    getClaims: vi.fn(() => Promise.resolve(ok(claims()))),
    withUserTx: async (_c, fn) => {
      log.push('begin');
      try {
        const out = await fn({ log });
        log.push('commit');
        return out;
      } catch (e) {
        log.push('rollback');
        throw e;
      }
    },
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: true }),
    loadGrants: () =>
      Promise.resolve<Grant[]>([{ permission: approve.code, scope: { type: 'direct_reports' } }]),
    resolveResource: (_tx, ref) =>
      Promise.resolve(
        ref.id === ENROLLMENT
          ? { type: 'enrollment', id: ENROLLMENT, tenantId: TENANT, subjectManagerPersonId: PERSON }
          : null,
      ),
    writeAudit: (_tx, actor, record) => {
      audits.push({ actor, record });
      return Promise.resolve();
    },
    logError: vi.fn(),
    ...over,
  };
  return { rt, log, audits };
}

const Input = z.object({ enrollmentId: z.uuid() });

function makeAction(rt: ActionRuntime<FakeTx>, handler?: () => Promise<Result<string, AppError>>) {
  const defineAction = createDefineAction(rt);
  return defineAction({
    permission: approve,
    input: Input,
    resource: (input) => ({ type: 'enrollment', id: input.enrollmentId }),
    audit: (input) => ({
      action: 'tms.enrollment.approved',
      entityType: 'enrollment',
      entityId: input.enrollmentId,
    }),
    handler:
      handler ??
      (({ ctx, input }) =>
        Promise.resolve(ok(`approved ${input.enrollmentId} by ${ctx.actor.userId}`))),
  });
}

describe('defineAction (ADR 0003 §4)', () => {
  it('positive: runs the handler in a user transaction and records an audit event', async () => {
    const { rt, log, audits } = runtime();
    const action = makeAction(rt);
    const result = await action({ enrollmentId: ENROLLMENT });
    expect(result).toEqual(ok(`approved ${ENROLLMENT} by ${USER}`));
    expect(log).toEqual(['begin', 'commit']);
    expect(audits).toHaveLength(1);
    expect(action[DEFINE_ACTION_MARKER as keyof typeof action]).toBe('tms.enrollment.approve');
  });

  it('unauthenticated: no verified session → 401, nothing runs', async () => {
    const { rt, log } = runtime({
      getClaims: () => Promise.resolve(err(appError('UNAUTHENTICATED'))),
    });
    const result = await makeAction(rt)({ enrollmentId: ENROLLMENT });
    expect(!result.ok && result.error.status).toBe(401);
    expect(log).toEqual([]);
  });

  it('no tenant claim → 403 before any database work', async () => {
    const { rt, log } = runtime({ getClaims: () => Promise.resolve(ok(claims({}))) });
    const result = await makeAction(rt)({ enrollmentId: ENROLLMENT });
    expect(!result.ok && result.error.code).toBe('FORBIDDEN');
    expect(log).toEqual([]);
  });

  it('invalid input → 422 VALIDATION_FAILED with field errors before any database work', async () => {
    const { rt, log } = runtime();
    const result = await makeAction(rt)({ enrollmentId: 'not-a-uuid' });
    expect(!result.ok && result.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
      fieldErrors: [{ path: 'enrollmentId', code: 'INVALID_FORMAT' }],
    });
    expect(log).toEqual([]);
  });

  it('negative: no permission → 403 and rollback', async () => {
    const { rt, log } = runtime({ loadGrants: () => Promise.resolve([]) });
    const result = await makeAction(rt)({ enrollmentId: ENROLLMENT });
    expect(!result.ok && result.error.status).toBe(403);
    expect(log).toEqual(['begin', 'rollback']);
  });

  it('negative: out of scope / other tenant / unknown resource → 404 (no existence leak)', async () => {
    const other = runtime({
      resolveResource: () =>
        Promise.resolve({
          type: 'enrollment',
          id: ENROLLMENT,
          tenantId: 'other-tenant',
          subjectManagerPersonId: PERSON,
        }),
    });
    const r1 = await makeAction(other.rt)({ enrollmentId: ENROLLMENT });
    expect(!r1.ok && r1.error.status).toBe(404);

    const unknown = runtime();
    const r2 = await makeAction(unknown.rt)({
      enrollmentId: '55555555-5555-4555-8555-555555555555',
    });
    expect(!r2.ok && r2.error.status).toBe(404);
  });

  it('negative: AAL1 when AAL2 is required → step-up required', async () => {
    const sensitive = definePermissions('platform', [
      { code: 'platform.role.manage', label, description: label, risk: 'high', requiresAal2: true },
    ])['platform.role.manage'];
    const { rt } = runtime({
      loadSessionFacts: () => Promise.resolve({ active: true, aal2: true }),
      loadGrants: () =>
        Promise.resolve([{ permission: sensitive.code, scope: { type: 'tenant' } }]),
    });
    const action = createDefineAction(rt)({
      permission: sensitive,
      input: z.object({}),
      handler: () => Promise.resolve(ok(true)),
    });
    const result = await action({});
    expect(!result.ok && result.error.code).toBe('STEP_UP_REQUIRED');
  });

  it('a session the database does not let act in its organization does nothing (review L1)', async () => {
    const handler = vi.fn(() => Promise.resolve(ok('done')));
    const { rt, log, audits } = runtime({
      loadSessionFacts: () => Promise.resolve({ active: false, aal2: false }),
    });
    const result = await makeAction(rt, handler)({ enrollmentId: ENROLLMENT });
    expect(!result.ok && result.error.code).toBe('UNAUTHENTICATED');
    expect(handler).not.toHaveBeenCalled();
    expect(audits).toEqual([]);
    expect(log).toEqual(['begin', 'rollback']);
  });

  it('AAL2 permissions: the token, a confirmed app (database) and a code from the last 15 minutes (review H1/L3)', async () => {
    const sensitive = definePermissions('platform', [
      { code: 'platform.role.manage', label, description: label, risk: 'high', requiresAal2: true },
    ])['platform.role.manage'];
    const seconds = (ago: number) => Math.floor(Date.now() / 1000) - ago;
    const attempt = async (dbAal2: boolean, codeAgo: number | null) => {
      const extra = {
        tenant_id: TENANT,
        person_id: PERSON,
        aal: 'aal2',
        ...(codeAgo === null ? {} : { amr: [{ method: 'totp', timestamp: seconds(codeAgo) }] }),
      };
      const { rt } = runtime({
        getClaims: () => Promise.resolve(ok(claims(extra))),
        loadSessionFacts: () => Promise.resolve({ active: true, aal2: dbAal2 }),
        loadGrants: () =>
          Promise.resolve([{ permission: sensitive.code, scope: { type: 'tenant' } }]),
      });
      const action = createDefineAction(rt)({
        permission: sensitive,
        input: z.object({}),
        handler: () => Promise.resolve(ok(true)),
      });
      const result = await action({});
      return result.ok ? 'ok' : result.error.code;
    };
    expect(await attempt(true, 60)).toBe('ok');
    // A code from an app still waiting for its e-mailed confirmation does not count.
    expect(await attempt(false, 60)).toBe('STEP_UP_REQUIRED');
    // Older than 15 minutes, or no code time at all: the /mfa page asks again.
    expect(await attempt(true, 15 * 60 + 5)).toBe('STEP_UP_REQUIRED');
    expect(await attempt(true, null)).toBe('STEP_UP_REQUIRED');
  });

  it('handler failures roll back and are returned; unexpected errors become INTERNAL_ERROR with a correlation id', async () => {
    const domain = runtime();
    const r1 = await makeAction(domain.rt, () =>
      Promise.resolve(err(appError('CONFLICT_VERSION'))),
    )({ enrollmentId: ENROLLMENT });
    expect(!r1.ok && r1.error.code).toBe('CONFLICT_VERSION');
    expect(domain.log).toEqual(['begin', 'rollback']);
    expect(domain.audits).toHaveLength(0);

    const logError = vi.fn();
    const crash = runtime({ logError });
    const r2 = await makeAction(crash.rt, () =>
      Promise.reject(new Error('db down: secret detail')),
    )({
      enrollmentId: ENROLLMENT,
    });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error).toMatchObject({ code: 'INTERNAL_ERROR', status: 500, expose: false });
    expect(r2.error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(r2.error)).not.toContain('secret detail');
    expect(logError).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(expect.any(Error), {
      permission: 'tms.enrollment.approve',
      correlationId: r2.error.correlationId,
    });
  });

  it('non-exposed errors returned by handlers or identity reach the client only as INTERNAL_ERROR', async () => {
    const internal = defineErrorCodes({
      LMS_UPSTREAM_FAILED: { status: 500, messageKey: 'tms.errors.lmsUpstreamFailed' },
    }).LMS_UPSTREAM_FAILED;
    const leaky = appError(internal, { params: { host: 'lms.internal' }, correlationId: 'c-9' });
    const r1 = await makeAction(runtime().rt, () => Promise.resolve(err(leaky)))({
      enrollmentId: ENROLLMENT,
    });
    expect(!r1.ok && r1.error).toEqual({
      code: 'INTERNAL_ERROR',
      status: 500,
      messageKey: 'errors.internalError',
      expose: false,
      correlationId: 'c-9',
      params: { correlationId: 'c-9' },
    });
    const r2 = await makeAction(
      runtime({ getClaims: () => Promise.resolve(err(appError(internal))) }).rt,
    )({ enrollmentId: ENROLLMENT });
    expect(!r2.ok && r2.error.code).toBe('INTERNAL_ERROR');
  });

  it('verifies the session strictly (getUser round-trip) for high-risk and AAL2 permissions only', async () => {
    const perms2 = definePermissions('platform', [
      { code: 'platform.role.manage', label, description: label, risk: 'high', requiresAal2: true },
      {
        code: 'platform.export.run',
        label,
        description: label,
        risk: 'medium',
        requiresAal2: true,
      },
      { code: 'platform.user.read', label, description: label, risk: 'low', requiresAal2: false },
    ]);
    expect(requiresStrictVerification(perms2['platform.role.manage'])).toBe(true);
    expect(requiresStrictVerification(perms2['platform.export.run'])).toBe(true);
    expect(requiresStrictVerification(perms2['platform.user.read'])).toBe(false);
    expect(requiresStrictVerification(approve)).toBe(false);

    for (const [permission, strict] of [
      [perms2['platform.role.manage'], true],
      [perms2['platform.export.run'], true],
      [perms2['platform.user.read'], false],
    ] as const) {
      const getClaims = vi.fn(() => Promise.resolve(ok(claims())));
      const { rt } = runtime({ getClaims });
      await createDefineAction(rt)({
        permission,
        input: z.object({}),
        handler: () => Promise.resolve(ok(true)),
      })({});
      expect(getClaims).toHaveBeenCalledWith({ strict });
    }
  });

  it('tenant-wide actions (no resource) are denied (403) for own / org_units-only grants', async () => {
    const handler = vi.fn(() => Promise.resolve(ok(true)));
    for (const scope of [
      { type: 'own' },
      { type: 'org_units', orgUnitIds: ['ou1'], includeDescendants: true },
      { type: 'direct_reports' },
    ] as const) {
      const { rt, log } = runtime({
        loadSessionFacts: () => Promise.resolve({ active: true, aal2: true }),
        loadGrants: () => Promise.resolve([{ permission: approve.code, scope }]),
      });
      const result = await createDefineAction(rt)({
        permission: approve,
        input: z.object({}),
        handler,
      })({});
      expect(!result.ok && result.error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
      expect(log).toEqual(['begin', 'rollback']);
    }
    expect(handler).not.toHaveBeenCalled();

    const tenantWide = runtime({
      loadSessionFacts: () => Promise.resolve({ active: true, aal2: true }),
      loadGrants: () => Promise.resolve([{ permission: approve.code, scope: { type: 'tenant' } }]),
    });
    const allowed = await createDefineAction(tenantWide.rt)({
      permission: approve,
      input: z.object({}),
      handler: ({ ctx }) => Promise.resolve(ok(ctx.grants.map((g) => g.scope.type))),
    })({});
    expect(allowed).toEqual(ok(['tenant']));
  });

  it('scoped actions receive ALL matching grants (to build scopeFilter predicates)', async () => {
    const grants: Grant[] = [
      { permission: approve.code, scope: { type: 'own' } },
      { permission: approve.code, scope: { type: 'branches', branchIds: ['b1'] } },
      { permission: 'tms.session.read', scope: { type: 'tenant' } },
    ];
    const { rt } = runtime({ loadGrants: () => Promise.resolve(grants) });
    const action = createDefineAction(rt)({
      permission: approve,
      input: z.object({}),
      scoped: true,
      handler: ({ ctx }) => Promise.resolve(ok(ctx.grants)),
    });
    expect(await action({})).toEqual(ok(grants.slice(0, 2)));
  });

  it('skips audit when the definition returns no record', async () => {
    const { rt, audits } = runtime();
    const action = createDefineAction(rt)({
      permission: approve,
      input: Input,
      scoped: true,
      audit: () => null,
      handler: () => Promise.resolve(ok(1)),
    });
    expect((await action({ enrollmentId: ENROLLMENT })).ok).toBe(true);
    expect(audits).toHaveLength(0);
  });

  it('asks for one retry after a deadlock unless the action acts outside the database (review L1)', async () => {
    const options: unknown[] = [];
    const { rt } = runtime();
    const record: ActionRuntime<FakeTx> = {
      ...rt,
      withUserTx: (c, fn, o) => {
        options.push(o);
        return rt.withUserTx(c, fn, o);
      },
    };
    await makeAction(record)({ enrollmentId: ENROLLMENT });
    const external = createDefineAction(record)({
      permission: approve,
      input: Input,
      scoped: true,
      externalEffects: true,
      handler: () => Promise.resolve(ok(1)),
    });
    await external({ enrollmentId: ENROLLMENT });
    expect(options).toEqual([{ retryOnConflict: true }, { retryOnConflict: false }]);
  });

  it('a retried transaction runs the whole pipeline again and audits once', async () => {
    const logError = vi.fn();
    const { rt, log, audits } = runtime({ logError });
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    // What platform-db withUserTx does with retryOnConflict (tested there): one more transaction.
    const retrying: ActionRuntime<FakeTx> = {
      ...rt,
      withUserTx: async (c, fn, o) => {
        try {
          return await rt.withUserTx(c, fn, o);
        } catch (error) {
          if (o?.retryOnConflict !== true || error !== deadlock) throw error;
          return rt.withUserTx(c, fn, o);
        }
      },
    };
    let attempts = 0;
    const result = await makeAction(retrying, () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(deadlock) : Promise.resolve(ok('done'));
    })({ enrollmentId: ENROLLMENT });
    expect(result).toEqual(ok('done'));
    expect(log).toEqual(['begin', 'rollback', 'begin', 'commit']);
    expect(audits).toHaveLength(1);
    expect(logError).not.toHaveBeenCalled();
  });
});
