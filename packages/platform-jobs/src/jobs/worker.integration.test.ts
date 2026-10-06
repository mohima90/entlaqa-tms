/**
 * The job runner against PostgreSQL (T-M2-06a, ADR 0004/0005): graphile-worker installs its schema as
 * app_queue; an event committed by a request is fanned out by the dispatcher and delivered once per
 * subscriber inside the event tenant's system transaction (app_worker, RLS); failures roll back and
 * retry; a duplicate delivery does nothing.
 */
import { randomUUID } from 'node:crypto';
import { emitEvent } from '@jadarat/platform-db';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { createDatabase, createWithUserTx } from '@jadarat/platform-db';
import { createWithSystemTx } from '@jadarat/platform-db/jobs';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DeliveredEvent, type Subscriber, createSubscriberRegistry } from './registry';
import { type WorkerConfig, runPass } from './runner';
import { DELIVER_TASK, DISPATCH_TASK } from './tasks';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const appWorkerUrl = process.env.TEST_APP_WORKER_URL;
const appQueueUrl = process.env.TEST_APP_QUEUE_URL;
const configured = Boolean(ownerUrl && appServerUrl && appWorkerUrl && appQueueUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error(
    'TEST_DATABASE_URL, TEST_APP_SERVER_URL, TEST_APP_WORKER_URL and TEST_APP_QUEUE_URL must be set',
  );
}

const PROBE = 'com.entlaqa.platform.test.worker_probe';
const FAIL_ONCE = 'com.entlaqa.platform.test.worker_fail_once';

describe.skipIf(!configured)('job runner against PostgreSQL', () => {
  const owner = new pg.Client({ connectionString: ownerUrl });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const workerDb = createDatabase(appWorkerUrl ?? '', { max: 2 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSystemTx = createWithSystemTx(() => workerDb);
  const ids = {
    tenantA: randomUUID(),
    tenantB: randomUUID(),
    user: randomUUID(),
    session: randomUUID(),
    person: randomUUID(),
    personB: randomUUID(),
  };

  /** What the handlers saw: the event, and the tenants of the persons visible in its transaction. */
  const seen: { subscriber: string; event: DeliveredEvent; visibleTenants: string[] }[] = [];
  let failNext = true;
  const record =
    (name: string): Subscriber['handle'] =>
    async ({ tx, event }) => {
      const rows = await tx.execute<{ tenant_id: string }>(
        sql`select distinct tenant_id from platform.persons`,
      );
      seen.push({ subscriber: name, event, visibleTenants: rows.map((r) => r.tenant_id) });
    };
  const registry = createSubscriberRegistry([
    { name: 'test.probe', types: [PROBE], handle: record('test.probe') },
    { name: 'test.audit', types: [PROBE, FAIL_ONCE], handle: record('test.audit') },
    {
      name: 'test.fail_once',
      types: [FAIL_ONCE],
      handle: async (context) => {
        await record('test.fail_once')(context);
        if (failNext) {
          failNext = false;
          throw new Error('temporary failure');
        }
      },
    },
  ]);
  const logs: string[] = [];
  const config: WorkerConfig = {
    queueUrl: appQueueUrl ?? '',
    caPem: undefined,
    registry,
    withSystemTx,
    concurrency: 2,
    log: (level, message) => {
      logs.push(`${level}: ${message}`);
    },
  };

  const claims = () => {
    const result = brandVerifiedClaims({
      sub: ids.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: ids.session,
      tenant_id: ids.tenantA,
      person_id: ids.person,
    });
    if (!result.ok) throw new Error('bad fixture');
    return result.value;
  };

  const ownerQuery = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) =>
    (await owner.query<T>(text, values)).rows;
  const dispatchJobs = async () =>
    Number(
      (
        await ownerQuery<{ n: string }>(
          'select count(*) as n from graphile_worker.jobs where task_identifier = $1',
          [DISPATCH_TASK],
        )
      )[0]?.n,
    );
  const outbox = (id: string) =>
    ownerQuery<{ dispatched_at: Date | null; actor_type: string; tenant_id: string }>(
      'select dispatched_at, actor_type, tenant_id from platform.event_outbox where id = $1',
      [id],
    );
  const inbox = (id: string) =>
    ownerQuery<{ subscriber: string }>(
      'select subscriber from platform.event_inbox where event_id = $1 order by subscriber',
      [id],
    );

  beforeAll(async () => {
    await owner.connect();
    for (const [tenant, slug] of [
      [ids.tenantA, 'wa'],
      [ids.tenantB, 'wb'],
    ] as const) {
      await owner.query(
        `insert into platform.tenants (id, slug, name_ar, status) values ($1, $2, 'أ', 'active')`,
        [tenant, `${slug}-${tenant.slice(0, 8)}`],
      );
    }
    await owner.query('insert into auth.users (id, email) values ($1, $2)', [
      ids.user,
      `${ids.user}@example.test`,
    ]);
    await owner.query('insert into auth.sessions (id, user_id) values ($1, $2)', [
      ids.session,
      ids.user,
    ]);
    await owner.query(
      `insert into platform.persons (id, tenant_id, display_name_ar) values ($1, $2, 'أ'), ($3, $4, 'ب')`,
      [ids.person, ids.tenantA, ids.personB, ids.tenantB],
    );
    await owner.query(
      `insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values ($1, $2, $3, 'active')`,
      [ids.tenantA, ids.user, ids.person],
    );
    await owner.query(
      'insert into platform.session_context (session_id, user_id, active_tenant_id) values ($1, $2, $3)',
      [ids.session, ids.user, ids.tenantA],
    );
    // The first pass installs graphile-worker's schema (as app_queue) and settles older events.
    await runPass({ ...config, registry: createSubscriberRegistry([]) });
  });

  afterAll(async () => {
    await owner.query('delete from platform.session_context where user_id = $1', [ids.user]);
    await owner.query('delete from platform.tenant_memberships where user_id = $1', [ids.user]);
    await owner.query('delete from platform.persons where id = any($1::uuid[])', [
      [ids.person, ids.personB],
    ]);
    await owner.query('delete from auth.users where id = $1', [ids.user]);
    await owner.end();
    await serverDb.$client.end();
    await workerDb.$client.end();
  });

  it('graphile-worker runs as app_queue in its own schema', async () => {
    const [schema] = await ownerQuery<{ owner: string }>(
      `select nspowner::regrole::text as owner from pg_namespace where nspname = 'graphile_worker'`,
    );
    expect(schema?.owner).toBe('app_queue');
    const [migrations] = await ownerQuery<{ n: string }>(
      'select count(*) as n from graphile_worker.migrations',
    );
    expect(Number(migrations?.n)).toBeGreaterThan(0);
    const roles = await ownerQuery<{ role: string; usage: boolean }>(
      `select r as role, has_schema_privilege(r, 'graphile_worker', 'USAGE') as usage
       from unnest(array['app_server', 'app_worker', 'authenticated', 'anon']) r`,
    );
    expect(roles.filter((r) => r.usage)).toEqual([]);
  });

  it('a committed event reaches each subscriber exactly once, in its tenant', async () => {
    const before = await dispatchJobs();
    const [first, second] = await withUserTx(claims(), async (tx) => [
      await emitEvent(tx, { type: PROBE, data: { n: 1 } }),
      await emitEvent(tx, { type: PROBE, data: { n: 2 }, correlationId: 'corr-1' }),
    ]);
    if (!first || !second) throw new Error('no events');
    // One dispatch job per transaction, however many events it wrote.
    expect(await dispatchJobs()).toBe(before + 1);
    // A rolled-back transaction leaves neither events nor a dispatch job.
    await expect(
      withUserTx(claims(), async (tx) => {
        await emitEvent(tx, { type: PROBE });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await dispatchJobs()).toBe(before + 1);

    await runPass(config);
    const delivered = seen.filter((s) => s.event.id === first || s.event.id === second);
    expect(delivered.map((s) => `${s.subscriber}:${String(s.event.data.n)}`).sort()).toEqual([
      'test.audit:1',
      'test.audit:2',
      'test.probe:1',
      'test.probe:2',
    ]);
    for (const s of delivered) {
      expect(s.event).toMatchObject({ tenantId: ids.tenantA, type: PROBE, actorType: 'user' });
      expect(s.visibleTenants).toEqual([ids.tenantA]);
    }
    expect(delivered.find((s) => s.event.id === second)?.event.correlationId).toBe('corr-1');
    expect((await outbox(first))[0]?.dispatched_at).toBeInstanceOf(Date);
    expect(await inbox(first)).toEqual([
      { subscriber: 'test.audit' },
      { subscriber: 'test.probe' },
    ]);

    // A duplicate delivery (another job for the same event and subscriber) does nothing.
    const count = seen.length;
    await owner.query(`select graphile_worker.add_job($1, $2::json)`, [
      DELIVER_TASK,
      JSON.stringify({ eventId: first, subscriber: 'test.probe' }),
    ]);
    await runPass(config);
    expect(seen.length).toBe(count);
  });

  it('a failed handler rolls back with its inbox row and succeeds on retry', async () => {
    const eventId = await withSystemTx({ tenantId: ids.tenantB, jobId: 'test.worker:1' }, (tx) =>
      emitEvent(tx, { type: FAIL_ONCE }),
    );
    await runPass(config);
    // test.audit succeeded; test.fail_once failed and left no inbox row.
    expect(await inbox(eventId)).toEqual([{ subscriber: 'test.audit' }]);
    const [job] = await ownerQuery<{ attempts: number; last_error: string | null; id: string }>(
      `select id, attempts, last_error from graphile_worker.jobs where key = $1`,
      [`test.fail_once:${eventId}`],
    );
    expect(job).toMatchObject({ attempts: 1 });
    expect(job?.last_error).toContain('temporary failure');
    expect(logs.some((l) => l.startsWith('error: ') && l.includes(DELIVER_TASK))).toBe(true);

    // Retry now instead of after the back-off.
    await owner.query(
      'select graphile_worker.reschedule_jobs(array[$1::bigint], run_at := now())',
      [job?.id],
    );
    await runPass(config);
    expect(await inbox(eventId)).toEqual([
      { subscriber: 'test.audit' },
      { subscriber: 'test.fail_once' },
    ]);
    const attempts = seen.filter((s) => s.event.id === eventId);
    expect(attempts.map((s) => s.subscriber).sort()).toEqual([
      'test.audit',
      'test.fail_once',
      'test.fail_once',
    ]);
    for (const s of attempts) {
      expect(s.event).toMatchObject({ tenantId: ids.tenantB, actorType: 'system' });
      expect(s.visibleTenants).toEqual([ids.tenantB]);
    }
    expect((await outbox(eventId))[0]).toMatchObject({
      actor_type: 'system',
      tenant_id: ids.tenantB,
    });
  });
});
