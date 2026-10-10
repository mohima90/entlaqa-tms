/**
 * The worker's purge of ended sessions against PostgreSQL (T-M2-10, private.purge_ended_sessions; T-M2-09 ×
 * T-M2-10 integration review): it never waits for another transaction. A login whose sessions another
 * transaction is ending (its login lock: a deactivation, a force sign-out, the device limit) and a session
 * whose sign-in context row another transaction holds (a request recording its activity, an organization
 * switch, a deactivation) are left to the next run — and purged then.
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { createWithPlatformTx, purgeEndedSessions } from './jobs';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appWorkerUrl = process.env.TEST_APP_WORKER_URL;
const configured = Boolean(ownerUrl && appWorkerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_WORKER_URL must be set');
}

function signal() {
  let fire: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return {
    promise,
    fire: () => {
      fire();
    },
  };
}

describe.skipIf(!configured)('purge of ended sessions against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 3, onnotice: () => undefined });
  const workerDb = createDatabase(appWorkerUrl ?? '', { max: 1 });
  const withPlatformTx = createWithPlatformTx(() => workerDb);
  const tenant = randomUUID();
  // Signed in 25 hours ago (past the platform's 24 hours): all three are due.
  const lockedLogin = { user: randomUUID(), session: randomUUID() };
  const inUse = { user: randomUUID(), session: randomUUID(), person: randomUUID() };
  const free = { user: randomUUID(), session: randomUUID() };
  const accounts = [lockedLogin, inUse, free];

  const exists = async (session: string) => {
    const [row] = await owner<{ n: number }[]>`
      select count(*)::int as n from auth.sessions where id = ${session}`;
    return row?.n === 1;
  };
  const purge = () =>
    withPlatformTx({ jobId: 'test.session_purge' }, (tx) => purgeEndedSessions(tx, 1000));

  beforeAll(async () => {
    await owner`insert into platform.tenants (id, slug, name_ar, status)
      values (${tenant}, ${`sp-${tenant.slice(0, 8)}`}, 'أ', 'active')`;
    for (const account of accounts) {
      await owner`insert into auth.users (id, email)
        values (${account.user}, ${`${account.user}@example.test`})`;
      await owner`insert into auth.sessions (id, user_id, created_at)
        values (${account.session}, ${account.user}, now() - interval '25 hours')`;
    }
    await owner`insert into platform.persons (id, tenant_id, display_name_ar)
      values (${inUse.person}, ${tenant}, 'ب')`;
    await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${tenant}, ${inUse.user}, ${inUse.person}, 'active')`;
    await owner`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${inUse.session}, ${inUse.user}, ${tenant})`;
  });

  afterAll(async () => {
    for (const account of accounts) await owner`delete from auth.users where id = ${account.user}`;
    await owner`delete from platform.persons where tenant_id = ${tenant}`;
    await owner.end();
    await workerDb.$client.end();
  });

  it('never waits: a login being ended elsewhere and a session in use are left for the next run', async () => {
    const { promise: held, fire: release } = signal();
    const { promise: locked, fire: lockedNow } = signal();
    // Another transaction holds the login lock of one account and the sign-in context row of another.
    const holder = owner.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`platform.login_sessions:${lockedLogin.user}`}, 0))`;
      await tx`select 1 from platform.session_context where session_id = ${inUse.session} for update`;
      lockedNow();
      await held;
    });
    await locked;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const waited = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('the purge waited for another transaction'));
        }, 10_000);
      });
      await Promise.race([purge(), waited]);
    } finally {
      clearTimeout(timer);
      release();
      await holder;
    }
    expect(await exists(free.session)).toBe(false);
    expect(await exists(lockedLogin.session)).toBe(true);
    expect(await exists(inUse.session)).toBe(true);

    // The next run takes them.
    await purge();
    expect(await exists(lockedLogin.session)).toBe(false);
    expect(await exists(inUse.session)).toBe(false);
    const markers = await owner<{ reason: string }[]>`
      select reason from private.revoked_sessions
      where session_id in (${free.session}, ${lockedLogin.session}, ${inUse.session})`;
    expect(markers.map((m) => m.reason)).toEqual(['expired', 'expired', 'expired']);
  });
});
