import type { SystemTx, WithSystemTx } from '@jadarat/platform-db/jobs';
import type { JobHelpers } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { JobError } from './errors';
import {
  type DeliveredEvent,
  type EffectSubscriber,
  type Subscriber,
  type TransactionalSubscriber,
  createSubscriberRegistry,
} from './registry';
import {
  DELIVER_TASK,
  DISPATCH_BATCH,
  DISPATCH_JOB_OPTIONS,
  DISPATCH_TASK,
  createTaskList,
  deliverTask,
  dispatchTask,
} from './tasks';

const EVENT_ID = '0b7c6c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
const TENANT_ID = '6f1c2a7e-3b8d-4c55-8e2f-7a9b0c1d2e3f';
const CREATED = 'com.entlaqa.platform.invitation.created';

interface Query {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

/** Fake graphile-worker helpers: a pg client that records queries and answers the outbox select. */
function fakeHelpers(outbox: { id: string; type: string }[], options: { failOn?: RegExp } = {}) {
  const queries: Query[] = [];
  const client = {
    query: vi.fn((text: string, values?: readonly unknown[]) => {
      queries.push({ text, values });
      if (options.failOn?.test(text)) {
        return Promise.reject(Object.assign(new Error('value "Sara" failed'), { code: '23505' }));
      }
      return Promise.resolve({ rows: text.includes('from platform.event_outbox') ? outbox : [] });
    }),
  };
  const warn = vi.fn();
  const helpers = {
    withPgClient: <T>(fn: (c: typeof client) => Promise<T>) => fn(client),
    addJob: vi.fn(() => Promise.resolve({})),
    query: vi.fn(),
    job: { id: '42', attempts: 2, max_attempts: 8 },
    logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
  return { helpers: helpers as unknown as JobHelpers & typeof helpers, queries, warn };
}

const handlerMock = () => vi.fn<TransactionalSubscriber['handle']>(() => Promise.resolve());
const handler = (name: string, types = [CREATED], handle = handlerMock()) =>
  ({ name, types, handle }) satisfies Subscriber;
const verb = (q: Query) => q.text.trim().split(/\s+/)[0];

describe('dispatchTask', () => {
  it('queues one delivery per subscriber and event in one call, then marks the batch dispatched', async () => {
    const registry = createSubscriberRegistry([
      handler('notifications.email'),
      handler('audit.projector'),
      { ...handler('slow'), maxAttempts: 3 },
    ]);
    const { helpers, queries } = fakeHelpers([
      { id: EVENT_ID, type: CREATED },
      { id: 'e2', type: 'com.entlaqa.tms.session.cancelled' },
    ]);
    await dispatchTask(registry)({}, helpers);
    expect(queries.map(verb)).toEqual(['begin', 'select', 'select', 'update', 'commit']);
    const add = queries.find((q) => q.text.includes('add_jobs'));
    expect(add?.values).toEqual([
      DELIVER_TASK,
      ['notifications.email', 'audit.projector', 'slow'].map((subscriber) =>
        JSON.stringify({ eventId: EVENT_ID, subscriber }),
      ),
      ['notifications.email', 'audit.projector', 'slow'].map((s) => `${s}:${EVENT_ID}`),
      [10, 10, 3],
    ]);
    // Events nobody subscribes to are marked dispatched too.
    expect(queries.find((q) => verb(q) === 'update')?.values).toEqual([[EVENT_ID, 'e2']]);
    expect(helpers.addJob).not.toHaveBeenCalled();
  });

  it('does nothing but commit when no event is pending', async () => {
    const { helpers, queries } = fakeHelpers([]);
    await dispatchTask(createSubscriberRegistry([]))({}, helpers);
    expect(queries.map(verb)).toEqual(['begin', 'select', 'commit']);
  });

  it('queues the next dispatch at once after a full batch', async () => {
    const rows = Array.from({ length: DISPATCH_BATCH }, (_, i) => ({
      id: `e${String(i)}`,
      type: CREATED,
    }));
    const { helpers } = fakeHelpers(rows);
    await dispatchTask(createSubscriberRegistry([]))({}, helpers);
    expect(helpers.addJob).toHaveBeenCalledWith(DISPATCH_TASK, {}, DISPATCH_JOB_OPTIONS);
    expect(DISPATCH_JOB_OPTIONS).not.toHaveProperty('queueName');
  });

  it('rolls back and fails without the error message', async () => {
    const { helpers, queries } = fakeHelpers([{ id: EVENT_ID, type: CREATED }], {
      failOn: /^update/,
    });
    const failure = await Promise.resolve()
      .then(() => dispatchTask(createSubscriberRegistry([]))({}, helpers))
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(JobError);
    expect((failure as Error).message).toBe('dispatch failed: Error [23505]');
    expect(queries.at(-1)?.text).toBe('rollback');
  });
});

describe('deliverTask', () => {
  const row = {
    id: EVENT_ID,
    tenant_id: TENANT_ID,
    type: CREATED,
    schema_version: 1,
    subject: null,
    data: { invitationId: 'i1' },
    actor_type: 'user',
    actor_id: '11111111-1111-4111-8111-111111111111',
    actor_job: null,
    correlation_id: 'c1',
    created_at: new Date('2026-10-06T10:00:00Z'),
  };

  /** withSystemTx double: the tenant is served or not; the inbox insert succeeds or not. */
  function fakeSystemTx(options: { firstDelivery: boolean; served?: boolean }) {
    const actors: unknown[] = [];
    const statements: string[] = [];
    const tx = {
      execute: vi.fn((query: { queryChunks?: unknown[] }) => {
        const text = JSON.stringify(query.queryChunks ?? '');
        statements.push(text.includes('current_tenant_id') ? 'served' : 'inbox');
        if (text.includes('current_tenant_id')) {
          return Promise.resolve([{ served: options.served ?? true }]);
        }
        return Promise.resolve(options.firstDelivery ? [{ event_id: EVENT_ID }] : []);
      }),
    };
    const withSystemTx: WithSystemTx = (actor, fn) => {
      actors.push(actor);
      return fn(tx as unknown as SystemTx);
    };
    return { withSystemTx, actors, tx, statements };
  }

  const run = async (
    subscribers: Subscriber[],
    payload: unknown,
    outbox: unknown[],
    systemTx = fakeSystemTx({ firstDelivery: true }),
  ) => {
    const { helpers, warn } = fakeHelpers([]);
    helpers.query.mockResolvedValue({ rows: outbox });
    await deliverTask(createSubscriberRegistry(subscribers), systemTx.withSystemTx)(
      payload,
      helpers,
    );
    return { warn, ...systemTx };
  };
  const payload = { eventId: EVENT_ID, subscriber: 'notifications.email' };

  it('runs the handler once, in the tenant of the event, after the tenant check and the inbox row', async () => {
    const handle = handlerMock();
    const { actors, tx, statements } = await run(
      [handler('notifications.email', [CREATED], handle)],
      payload,
      [row],
    );
    expect(actors).toEqual([{ tenantId: TENANT_ID, jobId: `${DELIVER_TASK}:42` }]);
    expect(statements).toEqual(['served', 'inbox']);
    const expected: DeliveredEvent = {
      id: EVENT_ID,
      tenantId: TENANT_ID,
      type: CREATED,
      version: 1,
      subject: null,
      data: { invitationId: 'i1' },
      actorType: 'user',
      actorId: '11111111-1111-4111-8111-111111111111',
      actorJob: null,
      correlationId: 'c1',
      createdAt: row.created_at,
    };
    expect(handle).toHaveBeenCalledWith({ tx, event: expected });
  });

  it('skips the handler when the inbox already has the event (retry or duplicate)', async () => {
    const handle = handlerMock();
    await run(
      [handler('notifications.email', [CREATED], handle)],
      payload,
      [row],
      fakeSystemTx({ firstDelivery: false }),
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it('skips organizations that are not active, without an inbox row', async () => {
    const handle = handlerMock();
    const { warn, statements } = await run(
      [handler('notifications.email', [CREATED], handle)],
      payload,
      [row],
      fakeSystemTx({ firstDelivery: true, served: false }),
    );
    expect(statements).toEqual(['served']);
    expect(handle).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('organization not active; delivery skipped');
  });

  it('skips unknown subscribers, events no longer in the outbox and types no longer handled', async () => {
    const handle = handlerMock();
    const subscribers = [handler('notifications.email', [CREATED], handle)];
    const removed = await run(subscribers, { eventId: EVENT_ID, subscriber: 'removed' }, [row]);
    const gone = await run(subscribers, payload, []);
    const dropped = await run(subscribers, payload, [{ ...row, type: 'com.entlaqa.tms.x.y' }]);
    for (const result of [removed, gone, dropped]) {
      expect(result.warn).toHaveBeenCalledTimes(1);
      expect(result.actors).toEqual([]);
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('fails with a cleaned error: class and code, never the message', async () => {
    const handle = vi.fn<TransactionalSubscriber['handle']>(() =>
      Promise.reject(Object.assign(new TypeError('no e-mail for سارة أحمد'), { code: 'P0001' })),
    );
    const failure = await run([handler('notifications.email', [CREATED], handle)], payload, [
      row,
    ]).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(JobError);
    expect((failure as Error).message).toBe('delivery failed: TypeError [P0001]');
    expect((failure as Error).stack).not.toContain('سارة');
    // A malformed payload too.
    const malformed = await run([], { eventId: 'x', subscriber: 'a' }, []).catch((e: unknown) => e);
    expect((malformed as Error).message).toBe('delivery failed: ZodError');
  });

  it('effect subscribers run outside the inbox, with the tenant bound and the attempt numbers', async () => {
    const perform = vi.fn<EffectSubscriber['perform']>(() => Promise.resolve());
    const effect: EffectSubscriber = {
      kind: 'effect',
      name: 'notifications.email',
      types: [CREATED],
      perform,
    };
    const systemTx = fakeSystemTx({ firstDelivery: true });
    const { statements, actors } = await run([effect], payload, [row], systemTx);
    expect(statements).toEqual(['served']);
    expect(perform).toHaveBeenCalledTimes(1);
    const context = perform.mock.calls[0]?.[0];
    expect(context).toMatchObject({ attempt: 2, maxAttempts: 8, event: { id: EVENT_ID } });
    // inTenant opens a transaction of the event's tenant.
    await context?.inTenant(() => Promise.resolve());
    expect(actors).toEqual([
      { tenantId: TENANT_ID, jobId: `${DELIVER_TASK}:42` },
      { tenantId: TENANT_ID, jobId: `${DELIVER_TASK}:42` },
    ]);

    const skipped = vi.fn<EffectSubscriber['perform']>(() => Promise.resolve());
    const { warn } = await run(
      [{ ...effect, perform: skipped }],
      payload,
      [row],
      fakeSystemTx({ firstDelivery: true, served: false }),
    );
    expect(skipped).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('organization not active; delivery skipped');

    // A suspended organization: the subscriber may release what its record holds instead.
    const discard = vi.fn<NonNullable<EffectSubscriber['discard']>>(() => Promise.resolve());
    await run(
      [{ ...effect, perform: skipped, discard }],
      payload,
      [row],
      fakeSystemTx({ firstDelivery: true, served: false }),
    );
    expect(skipped).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ id: EVENT_ID }) }),
    );
  });

  it('the task list holds both tasks', () => {
    const list = createTaskList(
      createSubscriberRegistry([]),
      fakeSystemTx({ firstDelivery: true }).withSystemTx,
    );
    expect(Object.keys(list)).toEqual([DISPATCH_TASK, DELIVER_TASK]);
  });
});
