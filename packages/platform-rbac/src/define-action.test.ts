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
    expect(options).toMatchObject([{ retryOnConflict: true }, { retryOnConflict: false }]);
  });

  it('a passive read (integration review L1): asks the runtime for it by name, and only reads', async () => {
    const options: unknown[] = [];
    const { rt, log } = runtime();
    const record: ActionRuntime<FakeTx> = {
      ...rt,
      withUserTx: (c, fn, o) => {
        options.push(o);
        return rt.withUserTx(c, fn, o);
      },
    };
    const define = createDefineAction(record);
    const status = define({
      permission: approve,
      input: Input,
      resource: (input) => ({ type: 'enrollment', id: input.enrollmentId }),
      passiveRead: 'platform.user_import.status',
      handler: () => Promise.resolve(ok('v1')),
    });
    expect(await status({ enrollmentId: ENROLLMENT })).toEqual(ok('v1'));
    expect(options).toMatchObject([
      { retryOnConflict: true, passiveRead: 'platform.user_import.status' },
    ]);
    expect(log).toEqual(['begin', 'commit']);
    // An ordinary action never asks for it.
    await makeAction(record)({ enrollmentId: ENROLLMENT });
    expect(options[1]).not.toHaveProperty('passiveRead');
    // A passive read only reads: no audit, nothing before or after its transaction, no external effects.
    const base = {
      permission: approve,
      input: Input,
      scoped: true,
      passiveRead: 'platform.user_import.status',
      handler: () => Promise.resolve(ok(1)),
    } as const;
    for (const extra of [
      { audit: () => ({ action: 'tms.enrollment.read', entityType: 'enrollment' }) },
      { auditFailure: () => null },
      { beforeTransaction: () => Promise.resolve(ok(undefined)) },
      { afterCommit: ({ result }: { result: number }) => Promise.resolve(ok(result)) },
      { externalEffects: true },
      { queuesWork: true },
    ]) {
      expect(() => define({ ...base, ...extra })).toThrow('must only read');
    }
  });

  it('logs a retried transaction with the permission and the SQLSTATE only', async () => {
    const logTransactionRetry = vi.fn();
    const { rt } = runtime({ logTransactionRetry });
    const record: ActionRuntime<FakeTx> = {
      ...rt,
      withUserTx: (c, fn, o) => {
        o?.onRetry?.('40P01');
        return rt.withUserTx(c, fn, o);
      },
    };
    await makeAction(record)({ enrollmentId: ENROLLMENT });
    expect(logTransactionRetry).toHaveBeenCalledExactlyOnceWith({
      permission: 'tms.enrollment.approve',
      sqlState: '40P01',
    });
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

  describe('auditFailure (refused attempts, T-M2-11)', () => {
    const refusedAction = (rt: ActionRuntime<FakeTx>, grants = true) =>
      createDefineAction(rt)({
        permission: approve,
        input: Input,
        scoped: grants,
        handler: () => Promise.resolve(err(appError('RATE_LIMITED'))),
        // The error and the actor only — never the input (it may hold secrets: review INFO 9).
        auditFailure: (error, actor) =>
          error.code === 'RATE_LIMITED'
            ? {
                action: 'tms.enrollment.approve_failed',
                entityType: 'enrollment',
                data: { by: actor.userId },
              }
            : null,
      });

    it('writes the refused attempt in a new transaction after the rollback, then returns the refusal', async () => {
      const { rt, log, audits } = runtime();
      const result = await refusedAction(rt)({ enrollmentId: ENROLLMENT });
      expect(!result.ok && result.error.code).toBe('RATE_LIMITED');
      expect(log).toEqual(['begin', 'rollback', 'begin', 'commit']);
      expect(audits).toEqual([
        {
          actor: expect.objectContaining({ userId: USER, tenantId: TENANT }),
          record: {
            action: 'tms.enrollment.approve_failed',
            entityType: 'enrollment',
            data: { by: USER },
          },
        },
      ]);
    });

    it('is not called for authorization denials or when it returns no record', async () => {
      const denied = runtime({ loadGrants: () => Promise.resolve([]) });
      const r1 = await refusedAction(denied.rt)({ enrollmentId: ENROLLMENT });
      expect(!r1.ok && r1.error.code).toBe('FORBIDDEN');
      expect(denied.log).toEqual(['begin', 'rollback']);
      expect(denied.audits).toHaveLength(0);

      const other = runtime();
      const action = createDefineAction(other.rt)({
        permission: approve,
        input: Input,
        scoped: true,
        handler: () => Promise.resolve(err(appError('CONFLICT_VERSION'))),
        auditFailure: () => null,
      });
      await action({ enrollmentId: ENROLLMENT });
      expect(other.log).toEqual(['begin', 'rollback']);
    });

    it('never changes the answer when the failure audit cannot be written (logged)', async () => {
      const logError = vi.fn();
      const broken = runtime({
        logError,
        writeAudit: () => Promise.reject(new Error('audit table locked')),
      });
      const result = await refusedAction(broken.rt)({ enrollmentId: ENROLLMENT });
      expect(!result.ok && result.error.code).toBe('RATE_LIMITED');
      expect(logError).toHaveBeenCalledWith(expect.any(Error), {
        permission: 'tms.enrollment.approve',
        correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
    });
  });

  describe('beforeTransaction (work outside the transaction, T-M2-11 review)', () => {
    const limitedAction = (
      rt: ActionRuntime<FakeTx>,
      before: () => Promise<Result<void, AppError>>,
      order: string[],
    ) =>
      createDefineAction(rt)({
        permission: approve,
        input: Input,
        scoped: true,
        beforeTransaction: async ({ actor, input }) => {
          order.push(`before ${actor.userId} ${input.enrollmentId}`);
          return before();
        },
        handler: () => {
          order.push('handler');
          return Promise.resolve(ok('done'));
        },
      });

    it('runs before the transaction opens; a refusal is the answer and no transaction opens', async () => {
      const order: string[] = [];
      const allowed = runtime();
      const answer = await limitedAction(
        allowed.rt,
        () => Promise.resolve(ok(undefined)),
        order,
      )({
        enrollmentId: ENROLLMENT,
      });
      expect(answer).toEqual(ok('done'));
      expect(order).toEqual([`before ${USER} ${ENROLLMENT}`, 'handler']);
      // The session check's own short transaction, then the action's (L3).
      expect(allowed.log).toEqual(['begin', 'commit', 'begin', 'commit']);

      const refused = runtime();
      const r = await limitedAction(
        refused.rt,
        () => Promise.resolve(err(appError('RATE_LIMITED'))),
        [],
      )({ enrollmentId: ENROLLMENT });
      expect(!r.ok && r.error.code).toBe('RATE_LIMITED');
      // Only the session check ran; the action's transaction never opened.
      expect(refused.log).toEqual(['begin', 'commit']);
    });

    it('a throw (e.g. the limiter is down) is an internal error with a correlation id; nothing runs', async () => {
      const logError = vi.fn();
      const failing = runtime({ logError });
      const r = await limitedAction(
        failing.rt,
        () => Promise.reject(new Error('limiter unavailable')),
        [],
      )({ enrollmentId: ENROLLMENT });
      expect(!r.ok && r.error.code).toBe('INTERNAL_ERROR');
      expect(failing.log).toEqual(['begin', 'commit']);
      expect(logError).toHaveBeenCalled();
    });

    it('checks the session first, in its own transaction that ends before beforeTransaction runs (integration review L3)', async () => {
      // An inactive session (ended, its membership gone, or refused by its organization's MFA policy):
      // UNAUTHENTICATED, and the per-actor work (e.g. counting a password check) never happens.
      const order: string[] = [];
      const inactive = runtime({
        loadSessionFacts: () => Promise.resolve({ active: false, aal2: false }),
      });
      const before = vi.fn(() => Promise.resolve(ok(undefined)));
      const r = await limitedAction(inactive.rt, before, order)({ enrollmentId: ENROLLMENT });
      expect(!r.ok && r.error.code).toBe('UNAUTHENTICATED');
      expect(before).not.toHaveBeenCalled();
      expect(order).toEqual([]);
      expect(inactive.log).toEqual(['begin', 'commit']);

      // An active one: the check's transaction is over before beforeTransaction starts — never nested.
      const steps: string[] = [];
      let open = 0;
      const sequential = runtime({
        withUserTx: async (_c, fn) => {
          open += 1;
          steps.push(`begin (${String(open)} open)`);
          try {
            return await fn({ log: steps });
          } finally {
            open -= 1;
            steps.push('end');
          }
        },
        loadSessionFacts: () => {
          steps.push('session facts');
          return Promise.resolve({ active: true, aal2: false });
        },
      });
      const answer = await createDefineAction(sequential.rt)({
        permission: approve,
        input: Input,
        scoped: true,
        beforeTransaction: () => {
          steps.push(`before (${String(open)} open)`);
          return Promise.resolve(ok(undefined));
        },
        handler: () => Promise.resolve(ok('done')),
      })({ enrollmentId: ENROLLMENT });
      expect(answer).toEqual(ok('done'));
      expect(steps).toEqual([
        'begin (1 open)',
        'session facts',
        'end',
        'before (0 open)',
        'begin (1 open)',
        'session facts',
        'end',
      ]);
    });

    it('offers a short read transaction of its own, with the same claims, ended before the action’s (M2)', async () => {
      const steps: string[] = [];
      let open = 0;
      const claimsSeen: unknown[] = [];
      const sequential = runtime({
        withUserTx: async (claims, fn) => {
          claimsSeen.push(claims);
          open += 1;
          steps.push(`begin (${String(open)} open)`);
          try {
            return await fn({ log: steps });
          } finally {
            open -= 1;
            steps.push('end');
          }
        },
        loadSessionFacts: () => Promise.resolve({ active: true, aal2: false }),
      });
      const answer = await createDefineAction(sequential.rt)({
        permission: approve,
        input: Input,
        scoped: true,
        beforeTransaction: async ({ read }) => {
          const value = await read((tx) => {
            steps.push(`read (${String(open)} open)`);
            expect(tx.log).toBe(steps);
            return Promise.resolve(41);
          });
          steps.push(`after read (${String(open)} open)`);
          return ok(value + 1);
        },
        handler: ({ before }) => {
          steps.push(`handler ${String(before)}`);
          return Promise.resolve(ok('done'));
        },
      })({ enrollmentId: ENROLLMENT });
      expect(answer).toEqual(ok('done'));
      expect(steps).toEqual([
        'begin (1 open)',
        'end',
        'begin (1 open)',
        'read (1 open)',
        'end',
        'after read (0 open)',
        'begin (1 open)',
        'handler 42',
        'end',
      ]);
      // The session check, the read and the action: the same verified claims.
      expect(claimsSeen).toHaveLength(3);
      expect(new Set(claimsSeen).size).toBe(1);
    });

    it('runs beforeTransaction once, also when the action’s transaction is retried; externalEffects still turns the retry off', async () => {
      const calls: { retryOnConflict: boolean | undefined }[] = [];
      const retrying = runtime({
        withUserTx: async (_c, fn, options) => {
          calls.push({ retryOnConflict: options?.retryOnConflict });
          // A retried transaction (deadlock victim): the runtime runs `fn` again.
          if (options?.retryOnConflict === true) {
            try {
              await fn({ log: [] });
            } catch {
              // the first run's outcome is discarded, as after a rollback
            }
            options.onRetry?.('40P01');
          }
          return fn({ log: [] });
        },
      });
      const before = vi.fn(() => Promise.resolve(ok(undefined)));
      const handler = vi.fn(() => Promise.resolve(ok('done')));
      const define = createDefineAction(retrying.rt);
      const plain = define({
        permission: approve,
        input: Input,
        scoped: true,
        beforeTransaction: before,
        handler,
      });
      expect(await plain({ enrollmentId: ENROLLMENT })).toEqual(ok('done'));
      expect(before).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(2);
      // The session check (no options) and the action's transaction (retry on conflict).
      expect(calls).toEqual([{ retryOnConflict: undefined }, { retryOnConflict: true }]);

      calls.length = 0;
      before.mockClear();
      handler.mockClear();
      const external = define({
        permission: approve,
        input: Input,
        scoped: true,
        externalEffects: true,
        beforeTransaction: before,
        handler,
      });
      expect(await external({ enrollmentId: ENROLLMENT })).toEqual(ok('done'));
      expect(before).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([{ retryOnConflict: undefined }, { retryOnConflict: false }]);
    });

    it('hands its value to the handler — the same value when the transaction is retried (WP-ADM-02)', async () => {
      const retrying = runtime({
        withUserTx: async (_c, fn, options) => {
          if (options?.retryOnConflict === true) {
            try {
              await fn({ log: [] });
            } catch {
              // discarded, as after a rollback
            }
          }
          return fn({ log: [] });
        },
      });
      const seen: unknown[] = [];
      const before = vi.fn(() => Promise.resolve(ok({ read: 'bytes' })));
      const answer = await createDefineAction(retrying.rt)({
        permission: approve,
        input: Input,
        scoped: true,
        beforeTransaction: before,
        handler: ({ before: prepared }) => {
          seen.push(prepared);
          return Promise.resolve(ok('done'));
        },
      })({ enrollmentId: ENROLLMENT });
      expect(answer).toEqual(ok('done'));
      expect(before).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([{ read: 'bytes' }, { read: 'bytes' }]);
      expect(seen[0]).toBe(seen[1]);
    });

    it('an action without beforeTransaction opens one transaction, as before', async () => {
      const { rt, log } = runtime();
      const r = await makeAction(rt)({ enrollmentId: ENROLLMENT });
      expect(r.ok).toBe(true);
      expect(log).toEqual(['begin', 'commit']);
    });

    it('regression: more concurrent actions than pool connections all complete (none held while waiting for another)', async () => {
      // A pool of 2 connections shared by the action's transaction and the limiter's own transaction (the
      // shape of the app_server pool). Holding a connection in withUserTx while the handler waited for a
      // second one deadlocked with 2+ concurrent requests; beforeTransaction runs with none held.
      const POOL = 2;
      let free = POOL;
      const waiting: (() => void)[] = [];
      const acquire = async () => {
        if (free > 0) {
          free -= 1;
          return;
        }
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
      };
      const release = () => {
        const next = waiting.shift();
        if (next) next();
        else free += 1;
      };
      const pooled = async <T>(fn: () => Promise<T>): Promise<T> => {
        await acquire();
        try {
          // Hold the connection across a turn of the event loop, like a real round trip.
          await new Promise((resolve) => {
            setTimeout(resolve, 5);
          });
          return await fn();
        } finally {
          release();
        }
      };
      const { rt } = runtime({ withUserTx: (_c, fn) => pooled(() => fn({ log: [] })) });
      const action = createDefineAction(rt)({
        permission: approve,
        input: Input,
        scoped: true,
        // The limiter's own short transaction on the same pool.
        beforeTransaction: () => pooled(() => Promise.resolve(ok(undefined))),
        handler: () => Promise.resolve(ok('done')),
      });
      const N = 8;
      const all = Promise.all(
        Array.from({ length: N }, () => action({ enrollmentId: ENROLLMENT })),
      );
      const timeout = new Promise<'deadlock'>((resolve) => {
        setTimeout(() => {
          resolve('deadlock');
        }, 2_000);
      });
      const results = await Promise.race([all, timeout]);
      expect(results).toEqual(Array.from({ length: N }, () => ok('done')));
      expect(free).toBe(POOL);

      // Control: the old shape — the limiter's transaction inside the handler — never completes.
      free = POOL;
      const nested = createDefineAction(rt)({
        permission: approve,
        input: Input,
        scoped: true,
        handler: () => pooled(() => Promise.resolve(ok('done'))),
      });
      const stuck = Promise.all(
        Array.from({ length: N }, () => nested({ enrollmentId: ENROLLMENT })),
      );
      const control = new Promise<'deadlock'>((resolve) => {
        setTimeout(() => {
          resolve('deadlock');
        }, 500);
      });
      expect(await Promise.race([stuck, control])).toBe('deadlock');
    });
  });

  describe('worker pass after queued work (ADR 0005 §1 amendment, 20 Oct 2026)', () => {
    function kickRuntime(over: Partial<ActionRuntime<FakeTx>> = {}) {
      const base = runtime(over);
      const kicks: { permission: string; log: string[] }[] = [];
      const rt: ActionRuntime<FakeTx> = {
        ...base.rt,
        requestWorkerPass: ({ permission }) => {
          kicks.push({ permission, log: [...base.log] });
        },
        ...over,
      };
      return { ...base, rt, kicks };
    }

    const define = (rt: ActionRuntime<FakeTx>, extra: Record<string, unknown> = {}) =>
      createDefineAction(rt)({
        permission: approve,
        input: Input,
        resource: (input) => ({ type: 'enrollment', id: input.enrollmentId }),
        handler: () => Promise.resolve(ok('done')),
        ...extra,
      });

    it('queuesWork: asks for a pass once, AFTER the commit, with the permission', async () => {
      const { rt, kicks } = kickRuntime();
      expect(await define(rt, { queuesWork: true })({ enrollmentId: ENROLLMENT })).toEqual(
        ok('done'),
      );
      expect(kicks).toEqual([{ permission: approve.code, log: ['begin', 'commit'] }]);
    });

    it('an event emitted in the transaction counts on its own (runtime.queuedWork, asked inside it)', async () => {
      const asked: string[][] = [];
      const { rt, kicks, log } = kickRuntime({
        queuedWork: () => {
          asked.push([...log]);
          return Promise.resolve(true);
        },
      });
      await define(rt)({ enrollmentId: ENROLLMENT });
      expect(asked).toEqual([['begin']]);
      expect(kicks).toEqual([{ permission: approve.code, log: ['begin', 'commit'] }]);
    });

    it('nothing queued → no pass', async () => {
      const { rt, kicks } = kickRuntime({ queuedWork: () => Promise.resolve(false) });
      await define(rt)({ enrollmentId: ENROLLMENT });
      expect(kicks).toEqual([]);
    });

    it('a refused or failed action never asks (its transaction rolled back)', async () => {
      const { rt, kicks, log } = kickRuntime({ queuedWork: () => Promise.resolve(true) });
      const refused = await define(rt, {
        queuesWork: true,
        handler: () => Promise.resolve(err(appError('CONFLICT_VERSION'))),
      })({ enrollmentId: ENROLLMENT });
      expect(!refused.ok && refused.error.code).toBe('CONFLICT_VERSION');
      const failed = await define(rt, {
        queuesWork: true,
        handler: () => Promise.reject(new Error('boom')),
      })({ enrollmentId: ENROLLMENT });
      expect(!failed.ok && failed.error.code).toBe('INTERNAL_ERROR');
      const denied = await define(rt, { queuesWork: true })({
        enrollmentId: '55555555-5555-4555-8555-555555555555',
      });
      expect(!denied.ok && denied.error.code).toBe('NOT_FOUND');
      expect(log.filter((step) => step === 'commit')).toEqual([]);
      expect(kicks).toEqual([]);
    });

    it('after a conflict retry, only the committed attempt decides', async () => {
      const conflict = Object.assign(new Error('deadlock'), { code: '40P01' });
      let attempt = 0;
      const base = kickRuntime({
        // First attempt "emits" and is rolled back as a deadlock victim; the second emits nothing.
        queuedWork: () => Promise.resolve(attempt === 1),
      });
      const rt: ActionRuntime<FakeTx> = {
        ...base.rt,
        withUserTx: async (c, fn, o) => {
          attempt += 1;
          try {
            return await base.rt.withUserTx(c, async (tx) => {
              const out = await fn(tx);
              if (attempt === 1) throw conflict;
              return out;
            });
          } catch (error) {
            if (error !== conflict || o?.retryOnConflict !== true) throw error;
            attempt += 1;
            return base.rt.withUserTx(c, fn);
          }
        },
      };
      expect(await define(rt)({ enrollmentId: ENROLLMENT })).toEqual(ok('done'));
      expect(base.kicks).toEqual([]);
    });

    it('a throwing requestWorkerPass never changes the answer; afterCommit still runs', async () => {
      const after = vi.fn(() => Promise.resolve(ok('after')));
      const { rt } = kickRuntime({
        requestWorkerPass: () => {
          throw new Error('kick failed');
        },
      });
      expect(
        await define(rt, { queuesWork: true, afterCommit: after })({ enrollmentId: ENROLLMENT }),
      ).toEqual(ok('after'));
      expect(after).toHaveBeenCalledOnce();
    });

    it('a runtime without requestWorkerPass (tests, tools) just commits', async () => {
      const { rt, log } = runtime();
      expect(await define(rt, { queuesWork: true })({ enrollmentId: ENROLLMENT })).toEqual(
        ok('done'),
      );
      expect(log).toEqual(['begin', 'commit']);
    });
  });

  describe('afterCommit (work after the commit, T-M2-18 integration review M1)', () => {
    const conflict = Object.assign(new Error('could not serialize access'), { code: '40001' });
    // What platform-db withUserTx does with retryOnConflict (tested there): one more transaction; `open`
    // counts the transactions in progress (a pooled connection held).
    const retryingRuntime = (over: Partial<ActionRuntime<FakeTx>> = {}) => {
      const state = { open: 0 };
      const base = runtime(over);
      const rt: ActionRuntime<FakeTx> = {
        ...base.rt,
        withUserTx: async (c, fn, o) => {
          const once = async () => {
            state.open += 1;
            try {
              return await base.rt.withUserTx(c, fn, o);
            } finally {
              state.open -= 1;
            }
          };
          try {
            return await once();
          } catch (error) {
            if (o?.retryOnConflict !== true || error !== conflict) throw error;
            o.onRetry?.('40001');
            return once();
          }
        },
      };
      return { ...base, rt, state };
    };

    it('runs once after the commit, with no transaction open, and shapes the answer from the result', async () => {
      const { rt, log, audits, state } = retryingRuntime();
      const seen: unknown[] = [];
      const action = createDefineAction(rt)({
        permission: approve,
        input: Input,
        resource: (input) => ({ type: 'enrollment', id: input.enrollmentId }),
        audit: (input) => ({ action: 'tms.enrollment.reserved', entityId: input.enrollmentId }),
        handler: ({ input }) => Promise.resolve(ok({ reservation: input.enrollmentId })),
        afterCommit: ({ actor, input, result }) => {
          seen.push({
            open: state.open,
            log: [...log],
            user: actor.userId,
            input: input.enrollmentId,
            result,
          });
          return Promise.resolve(ok(`signed ${result.reservation}`));
        },
      });
      expect(await action({ enrollmentId: ENROLLMENT })).toEqual(ok(`signed ${ENROLLMENT}`));
      expect(seen).toEqual([
        {
          open: 0,
          log: ['begin', 'commit'],
          user: USER,
          input: ENROLLMENT,
          result: { reservation: ENROLLMENT },
        },
      ]);
      expect(audits).toHaveLength(1);
    });

    it("the transaction step runs twice on 40001, afterCommit once (with the second attempt's result)", async () => {
      const logTransactionRetry = vi.fn();
      const { rt, log, audits } = retryingRuntime({ logTransactionRetry });
      let attempts = 0;
      const after = vi.fn(({ result }: { result: number }) => Promise.resolve(ok(result * 10)));
      const action = createDefineAction(rt)({
        permission: approve,
        input: Input,
        scoped: true,
        audit: () => ({ action: 'tms.enrollment.reserved' }),
        handler: () => {
          attempts += 1;
          return attempts === 1 ? Promise.reject(conflict) : Promise.resolve(ok(attempts));
        },
        afterCommit: after,
      });
      expect(await action({ enrollmentId: ENROLLMENT })).toEqual(ok(20));
      expect(attempts).toBe(2);
      expect(log).toEqual(['begin', 'rollback', 'begin', 'commit']);
      expect(after).toHaveBeenCalledOnce();
      expect(audits).toHaveLength(1);
      expect(logTransactionRetry).toHaveBeenCalledExactlyOnceWith({
        permission: 'tms.enrollment.approve',
        sqlState: '40001',
      });
    });

    it('externalEffects still turns the retry off with afterCommit present', async () => {
      const options: unknown[] = [];
      const { rt } = retryingRuntime();
      const recording: ActionRuntime<FakeTx> = {
        ...rt,
        withUserTx: (c, fn, o) => {
          options.push(o?.retryOnConflict);
          return rt.withUserTx(c, fn, o);
        },
      };
      const after = vi.fn(() => Promise.resolve(ok('after')));
      const define = createDefineAction(recording);
      const external = define({
        permission: approve,
        input: Input,
        scoped: true,
        externalEffects: true,
        handler: () => Promise.reject(conflict),
        afterCommit: after,
      });
      const refused = await external({ enrollmentId: ENROLLMENT });
      expect(!refused.ok && refused.error.code).toBe('INTERNAL_ERROR');
      expect(after).not.toHaveBeenCalled();
      const plain = define({
        permission: approve,
        input: Input,
        scoped: true,
        handler: () => Promise.resolve(ok(1)),
        afterCommit: after,
      });
      expect(await plain({ enrollmentId: ENROLLMENT })).toEqual(ok('after'));
      expect(options).toEqual([false, true]);
    });

    it('never runs for a refused, denied, inactive-session or failed action', async () => {
      const after = vi.fn(() => Promise.resolve(ok('after')));
      const define = (
        rt: ActionRuntime<FakeTx>,
        handler: () => Promise<Result<string, AppError>>,
      ) =>
        createDefineAction(rt)({
          permission: approve,
          input: Input,
          resource: (input) => ({ type: 'enrollment', id: input.enrollmentId }),
          handler,
          afterCommit: after,
        });
      const refused = await define(runtime().rt, () =>
        Promise.resolve(err(appError('CONFLICT_VERSION'))),
      )({
        enrollmentId: ENROLLMENT,
      });
      expect(!refused.ok && refused.error.code).toBe('CONFLICT_VERSION');
      const denied = await define(runtime({ loadGrants: () => Promise.resolve([]) }).rt, () =>
        Promise.resolve(ok('x')),
      )({ enrollmentId: ENROLLMENT });
      expect(!denied.ok && denied.error.code).toBe('FORBIDDEN');
      const inactive = await define(
        runtime({ loadSessionFacts: () => Promise.resolve({ active: false, aal2: false }) }).rt,
        () => Promise.resolve(ok('x')),
      )({ enrollmentId: ENROLLMENT });
      expect(!inactive.ok && inactive.error.code).toBe('UNAUTHENTICATED');
      const failed = await define(runtime().rt, () => Promise.reject(new Error('boom')))({
        enrollmentId: ENROLLMENT,
      });
      expect(!failed.ok && failed.error.code).toBe('INTERNAL_ERROR');
      expect(after).not.toHaveBeenCalled();
    });

    it('its refusal is the answer (a warning: permission and code) and its throw an internal error; the committed work stays', async () => {
      const logError = vi.fn();
      const logAfterCommitRefusal = vi.fn();
      const { rt, log, audits } = runtime({ logError, logAfterCommitRefusal });
      const define = (afterCommit: () => Promise<Result<string, AppError>>) =>
        createDefineAction(rt)({
          permission: approve,
          input: Input,
          scoped: true,
          audit: () => ({ action: 'tms.enrollment.reserved' }),
          handler: () => Promise.resolve(ok('reserved')),
          afterCommit,
        });
      const refusal = await define(() => Promise.resolve(err(appError('CONFLICT_VERSION'))))({
        enrollmentId: ENROLLMENT,
      });
      expect(!refusal.ok && refusal.error.code).toBe('CONFLICT_VERSION');
      expect(logAfterCommitRefusal).toHaveBeenCalledExactlyOnceWith({
        permission: 'tms.enrollment.approve',
        code: 'CONFLICT_VERSION',
      });
      expect(logError).not.toHaveBeenCalled();
      const thrown = await define(() => Promise.reject(new Error('storage down')))({
        enrollmentId: ENROLLMENT,
      });
      expect(!thrown.ok && thrown.error.code).toBe('INTERNAL_ERROR');
      expect(logError).toHaveBeenCalledOnce();
      expect(logAfterCommitRefusal).toHaveBeenCalledOnce();
      // Each action committed once; nothing was rolled back or run again.
      expect(log).toEqual(['begin', 'commit', 'begin', 'commit']);
      expect(audits).toHaveLength(2);
    });

    it("with beforeTransaction: session check, beforeTransaction, the action's transaction, then afterCommit — never nested", async () => {
      const steps: string[] = [];
      let open = 0;
      const { rt } = runtime({
        withUserTx: async (_c, fn) => {
          open += 1;
          steps.push(`begin (${String(open)} open)`);
          try {
            return await fn({ log: steps });
          } finally {
            open -= 1;
            steps.push('end');
          }
        },
        loadSessionFacts: () => {
          steps.push('session facts');
          return Promise.resolve({ active: true, aal2: false });
        },
      });
      const action = createDefineAction(rt)({
        permission: approve,
        input: Input,
        scoped: true,
        beforeTransaction: () => {
          steps.push(`before (${String(open)} open)`);
          return Promise.resolve(ok(undefined));
        },
        handler: () => {
          steps.push('handler');
          return Promise.resolve(ok('reserved'));
        },
        afterCommit: ({ result }) => {
          steps.push(`after ${result} (${String(open)} open)`);
          return Promise.resolve(ok('signed'));
        },
      });
      expect(await action({ enrollmentId: ENROLLMENT })).toEqual(ok('signed'));
      expect(steps).toEqual([
        'begin (1 open)',
        'session facts',
        'end',
        'before (0 open)',
        'begin (1 open)',
        'session facts',
        'handler',
        'end',
        'after reserved (0 open)',
      ]);
      // An inactive session: neither beforeTransaction nor afterCommit.
      const after = vi.fn(() => Promise.resolve(ok('signed')));
      const before = vi.fn(() => Promise.resolve(ok(undefined)));
      const inactive = runtime({
        loadSessionFacts: () => Promise.resolve({ active: false, aal2: false }),
      });
      const r = await createDefineAction(inactive.rt)({
        permission: approve,
        input: Input,
        scoped: true,
        beforeTransaction: before,
        handler: () => Promise.resolve(ok('reserved')),
        afterCommit: after,
      })({ enrollmentId: ENROLLMENT });
      expect(!r.ok && r.error.code).toBe('UNAUTHENTICATED');
      expect(before).not.toHaveBeenCalled();
      expect(after).not.toHaveBeenCalled();
    });

    it('regression: more concurrent actions than pool connections all complete when the service call runs in afterCommit', async () => {
      // The files service before M1 opened its own transaction inside the action's (ownTx): with more
      // concurrent actions than connections, each held one and waited for another. afterCommit holds none.
      const POOL = 2;
      let free = POOL;
      const waiting: (() => void)[] = [];
      const acquire = async () => {
        if (free > 0) {
          free -= 1;
          return;
        }
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
      };
      const release = () => {
        const next = waiting.shift();
        if (next) next();
        else free += 1;
      };
      const pooled = async <T>(fn: () => Promise<T>): Promise<T> => {
        await acquire();
        try {
          await new Promise((resolve) => {
            setTimeout(resolve, 5);
          });
          return await fn();
        } finally {
          release();
        }
      };
      const { rt } = runtime({ withUserTx: (_c, fn) => pooled(() => fn({ log: [] })) });
      const action = createDefineAction(rt)({
        permission: approve,
        input: Input,
        scoped: true,
        handler: () => Promise.resolve(ok('reserved')),
        // A network call (Storage) that holds no connection, then the answer.
        afterCommit: async ({ result }) => {
          await new Promise((resolve) => {
            setTimeout(resolve, 5);
          });
          return ok(`${result} and signed`);
        },
      });
      const N = 8;
      const all = Promise.all(
        Array.from({ length: N }, () => action({ enrollmentId: ENROLLMENT })),
      );
      const timeout = new Promise<'deadlock'>((resolve) => {
        setTimeout(() => {
          resolve('deadlock');
        }, 2_000);
      });
      expect(await Promise.race([all, timeout])).toEqual(
        Array.from({ length: N }, () => ok('reserved and signed')),
      );
      expect(free).toBe(POOL);
    });
  });
});
