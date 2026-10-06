import type { SystemTx, WithSystemTx } from '@jadarat/platform-db/jobs';
import type { JobHelpers } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { type DeliveredEvent, type Subscriber, createSubscriberRegistry } from './registry';
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
      if (options.failOn?.test(text)) return Promise.reject(new Error('boom'));
      return Promise.resolve({ rows: text.includes('from platform.event_outbox') ? outbox : [] });
    }),
  };
  const warn = vi.fn();
  const helpers = {
    withPgClient: <T>(fn: (c: typeof client) => Promise<T>) => fn(client),
    addJob: vi.fn(() => Promise.resolve({})),
    query: vi.fn(),
    job: { id: '42' },
    logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
  return { helpers: helpers as unknown as JobHelpers & typeof helpers, queries, warn };
}

const handlerMock = () => vi.fn<Subscriber['handle']>(() => Promise.resolve());
const handler = (name: string, types = [CREATED], handle = handlerMock()) =>
  ({ name, types, handle }) satisfies Subscriber;

describe('dispatchTask', () => {
  it('adds one delivery job per subscriber and event, then marks the batch dispatched', async () => {
    const registry = createSubscriberRegistry([
      handler('notifications.email'),
      handler('audit.projector', [CREATED]),
      { ...handler('slow'), maxAttempts: 3 },
    ]);
    const { helpers, queries } = fakeHelpers([
      { id: EVENT_ID, type: CREATED },
      { id: 'e2', type: 'com.entlaqa.tms.session.cancelled' },
    ]);
    await dispatchTask(registry)({}, helpers);
    expect(queries.map((q) => q.text.trim().split(/\s+/)[0])).toEqual([
      'begin',
      'select',
      'select',
      'select',
      'select',
      'update',
      'commit',
    ]);
    const jobs = queries.filter((q) => q.text.includes('add_job')).map((q) => q.values);
    expect(jobs).toEqual([
      [
        DELIVER_TASK,
        JSON.stringify({ eventId: EVENT_ID, subscriber: 'notifications.email' }),
        `notifications.email:${EVENT_ID}`,
        10,
      ],
      [
        DELIVER_TASK,
        JSON.stringify({ eventId: EVENT_ID, subscriber: 'audit.projector' }),
        `audit.projector:${EVENT_ID}`,
        10,
      ],
      [
        DELIVER_TASK,
        JSON.stringify({ eventId: EVENT_ID, subscriber: 'slow' }),
        `slow:${EVENT_ID}`,
        3,
      ],
    ]);
    // Events nobody subscribes to are marked dispatched too.
    expect(queries.find((q) => q.text.startsWith('update'))?.values).toEqual([[EVENT_ID, 'e2']]);
    expect(helpers.addJob).not.toHaveBeenCalled();
  });

  it('does nothing but commit when no event is pending', async () => {
    const { helpers, queries } = fakeHelpers([]);
    await dispatchTask(createSubscriberRegistry([]))({}, helpers);
    expect(queries.map((q) => q.text.trim().split(/\s+/)[0])).toEqual([
      'begin',
      'select',
      'commit',
    ]);
  });

  it('queues the next dispatch at once after a full batch', async () => {
    const rows = Array.from({ length: DISPATCH_BATCH }, (_, i) => ({
      id: `e${String(i)}`,
      type: CREATED,
    }));
    const { helpers } = fakeHelpers(rows);
    await dispatchTask(createSubscriberRegistry([]))({}, helpers);
    expect(helpers.addJob).toHaveBeenCalledWith(DISPATCH_TASK, {}, DISPATCH_JOB_OPTIONS);
  });

  it('rolls back and fails the job when a step fails', async () => {
    const { helpers, queries } = fakeHelpers([{ id: EVENT_ID, type: CREATED }], {
      failOn: /^update/,
    });
    await expect(dispatchTask(createSubscriberRegistry([]))({}, helpers)).rejects.toThrow('boom');
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
    correlation_id: 'c1',
    created_at: new Date('2026-10-06T10:00:00Z'),
  };

  /** withSystemTx double: records the actor and hands out a tx whose inbox insert succeeds or not. */
  function fakeSystemTx(firstDelivery: boolean) {
    const actors: unknown[] = [];
    const tx = {
      execute: vi.fn(() => Promise.resolve(firstDelivery ? [{ event_id: EVENT_ID }] : [])),
    };
    const withSystemTx: WithSystemTx = (actor, fn) => {
      actors.push(actor);
      return fn(tx as unknown as SystemTx);
    };
    return { withSystemTx, actors, tx };
  }

  it('runs the handler once, in the tenant of the event, with the inbox row', async () => {
    const handle = handlerMock();
    const sub = handler('notifications.email', [CREATED], handle);
    const { helpers } = fakeHelpers([]);
    helpers.query.mockResolvedValue({ rows: [row] });
    const { withSystemTx, actors, tx } = fakeSystemTx(true);
    await deliverTask(createSubscriberRegistry([sub]), withSystemTx)(
      { eventId: EVENT_ID, subscriber: 'notifications.email' },
      helpers,
    );
    expect(actors).toEqual([{ tenantId: TENANT_ID, jobId: `${DELIVER_TASK}:42` }]);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    const expected: DeliveredEvent = {
      id: EVENT_ID,
      tenantId: TENANT_ID,
      type: CREATED,
      version: 1,
      subject: null,
      data: { invitationId: 'i1' },
      actorType: 'user',
      correlationId: 'c1',
      createdAt: row.created_at,
    };
    expect(handle).toHaveBeenCalledWith({ tx, event: expected });
  });

  it('skips the handler when the inbox already has the event (retry or duplicate)', async () => {
    const handle = handlerMock();
    const sub = handler('notifications.email', [CREATED], handle);
    const { helpers } = fakeHelpers([]);
    helpers.query.mockResolvedValue({ rows: [row] });
    const { withSystemTx } = fakeSystemTx(false);
    await deliverTask(createSubscriberRegistry([sub]), withSystemTx)(
      { eventId: EVENT_ID, subscriber: 'notifications.email' },
      helpers,
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it('skips unknown subscribers and events no longer in the outbox', async () => {
    const handle = handlerMock();
    const sub = handler('notifications.email', [CREATED], handle);
    const { helpers, warn } = fakeHelpers([]);
    helpers.query.mockResolvedValue({ rows: [] });
    const { withSystemTx, actors } = fakeSystemTx(true);
    const task = deliverTask(createSubscriberRegistry([sub]), withSystemTx);
    await task({ eventId: EVENT_ID, subscriber: 'removed' }, helpers);
    await task({ eventId: EVENT_ID, subscriber: 'notifications.email' }, helpers);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(actors).toEqual([]);
    expect(handle).not.toHaveBeenCalled();
  });

  it('rejects a malformed payload', async () => {
    const { helpers } = fakeHelpers([]);
    const task = deliverTask(createSubscriberRegistry([]), fakeSystemTx(true).withSystemTx);
    await expect(task({ eventId: 'x', subscriber: 'a' }, helpers)).rejects.toThrow();
    await expect(
      task({ eventId: EVENT_ID, subscriber: 'a', extra: true }, helpers),
    ).rejects.toThrow();
  });

  it('the task list holds both tasks', () => {
    const list = createTaskList(createSubscriberRegistry([]), fakeSystemTx(true).withSystemTx);
    expect(Object.keys(list)).toEqual([DISPATCH_TASK, DELIVER_TASK]);
  });
});
