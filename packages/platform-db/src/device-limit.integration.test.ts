/**
 * The device limit applied by a request recording its activity (T-M2-10, private.touch_session; T-M2-09 ×
 * T-M2-10 integration follow-up) against PostgreSQL: the request holds its own session_context row from the
 * activity update on, so it never waits for the login's lock — while another transaction holds it (a
 * deactivation, a force sign-out, the purge), the device limit is left to the next touch, which applies it.
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { createWithUserTx } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
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

describe.skipIf(!configured)('device limit on activity against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 3, onnotice: () => undefined });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const tenant = randomUUID();
  const user = randomUUID();
  const person = randomUUID();
  const older = randomUUID();
  const current = randomUUID();

  const claims = () => {
    const r = brandVerifiedClaims({
      sub: user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: current,
      tenant_id: tenant,
      person_id: person,
    });
    if (!r.ok) throw new Error('bad fixture');
    return r.value;
  };
  const exists = async (session: string) => {
    const [row] = await owner<{ n: number }[]>`
      select count(*)::int as n from auth.sessions where id = ${session}`;
    return row?.n === 1;
  };
  const applied = async () => {
    const [row] = await owner<{ applied: boolean }[]>`
      select device_limit_applied as applied from platform.session_context where session_id = ${current}`;
    return row?.applied;
  };

  beforeAll(async () => {
    await owner`insert into platform.tenants (id, slug, name_ar, status)
      values (${tenant}, ${`dl-${tenant.slice(0, 8)}`}, 'أ', 'active')`;
    // One device at a time in this organization.
    await owner`update platform.security_policies set session_max_devices = 1 where tenant_id = ${tenant}`;
    await owner`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`;
    await owner`insert into auth.sessions (id, user_id, created_at)
      values (${older}, ${user}, now() - interval '2 hours'), (${current}, ${user}, now() - interval '1 hour')`;
    await owner`insert into platform.persons (id, tenant_id, display_name_ar) values (${person}, ${tenant}, 'أ')`;
    await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${tenant}, ${user}, ${person}, 'active')`;
    await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select tenant_id, id, 'learner', true from platform.tenant_memberships
      where user_id = ${user} and tenant_id = ${tenant}`;
    // Both sessions act in the organization; the current one was last active two minutes ago and has not had
    // the device limit applied yet.
    await owner`insert into platform.session_context (session_id, user_id, active_tenant_id, last_seen_at)
      values (${older}, ${user}, ${tenant}, now()), (${current}, ${user}, ${tenant}, now() - interval '2 minutes')`;
  });

  afterAll(async () => {
    await owner`delete from auth.users where id = ${user}`;
    await owner`delete from platform.persons where tenant_id = ${tenant}`;
    await owner.end();
    await serverDb.$client.end();
  });

  it('never waits for the login lock: the device limit waits for the next touch instead', async () => {
    const { promise: held, fire: release } = signal();
    const { promise: locked, fire: lockedNow } = signal();
    const holder = owner.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`platform.login_sessions:${user}`}, 0))`;
      lockedNow();
      await held;
    });
    await locked;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const waited = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('the request waited for the login lock'));
        }, 10_000);
      });
      await Promise.race([withUserTx(claims(), (tx) => tx.execute(sql`select 1`)), waited]);
    } finally {
      clearTimeout(timer);
      release();
      await holder;
    }
    // The activity moved, the device limit did not run.
    expect(await exists(older)).toBe(true);
    expect(await applied()).toBe(false);

    // The next touch (a minute later) applies it: the older session ends.
    await owner`update platform.session_context set last_seen_at = now() - interval '2 minutes'
      where session_id = ${current}`;
    await withUserTx(claims(), (tx) => tx.execute(sql`select 1`));
    expect(await exists(older)).toBe(false);
    expect(await applied()).toBe(true);
  });
});
