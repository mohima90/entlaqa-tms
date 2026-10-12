/**
 * Passive reads against PostgreSQL (T-M2-12 integration review L1): an allow-listed read — the import
 * page's status poll — is not the session's activity (private.touch_session() is not called, so
 * last_seen_at stays where it was) and runs READ ONLY; it still needs a live session (an idle one is not
 * revived by it). An ordinary request moves the activity as before (T-M2-10 inactivity rule).
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { pgError } from './pg-error';
import { loadSessionFacts } from './security';
import { createWithUserTx } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('passive reads against PostgreSQL (integration review L1)', () => {
  const owner = postgres(ownerUrl ?? '', { max: 2, onnotice: () => undefined });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const tenant = randomUUID();
  const user = randomUUID();
  const person = randomUUID();
  const session = randomUUID();
  const passive = { passiveRead: 'platform.user_import.status' } as const;

  const claims = () => {
    const r = brandVerifiedClaims({
      sub: user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: session,
      tenant_id: tenant,
      person_id: person,
    });
    if (!r.ok) throw new Error('bad fixture');
    return r.value;
  };
  /** Minutes since the session's last recorded activity. */
  const idleMinutes = async () => {
    const [row] = await owner<{ minutes: number }[]>`
      select extract(epoch from now() - last_seen_at)::float / 60 as minutes
      from platform.session_context where session_id = ${session}`;
    return row?.minutes ?? Number.NaN;
  };
  const lastActive = (minutesAgo: number) =>
    owner`update platform.session_context
          set last_seen_at = now() - make_interval(mins => ${minutesAgo})
          where session_id = ${session}`;

  beforeAll(async () => {
    await owner`insert into platform.tenants (id, slug, name_ar, status)
      values (${tenant}, ${`pr-${tenant.slice(0, 8)}`}, 'أ', 'active')`;
    await owner`insert into auth.users (id, email) values (${user}, ${`${user}@example.test`})`;
    await owner`insert into auth.sessions (id, user_id, created_at)
      values (${session}, ${user}, now() - interval '1 hour')`;
    await owner`insert into platform.persons (id, tenant_id, display_name_ar) values (${person}, ${tenant}, 'أ')`;
    await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${tenant}, ${user}, ${person}, 'active')`;
    await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select tenant_id, id, 'learner', true from platform.tenant_memberships
      where user_id = ${user} and tenant_id = ${tenant}`;
    await owner`insert into platform.session_context (session_id, user_id, active_tenant_id, last_seen_at)
      values (${session}, ${user}, ${tenant}, now() - interval '10 minutes')`;
  });

  beforeEach(async () => {
    await lastActive(10);
  });

  afterAll(async () => {
    await owner`delete from auth.users where id = ${user}`;
    await owner`delete from platform.persons where tenant_id = ${tenant}`;
    await owner.end();
    await serverDb.$client.end();
  });

  it('is not the session activity: last_seen_at stays where it was', async () => {
    const facts = await withUserTx(claims(), (tx) => loadSessionFacts(tx), passive);
    expect(facts.active).toBe(true);
    expect(await idleMinutes()).toBeGreaterThan(9.9);
    // An ordinary request is activity.
    await withUserTx(claims(), (tx) => tx.execute(sql`select 1`));
    expect(await idleMinutes()).toBeLessThan(1);
  });

  it('runs read-only: a write is refused (25006)', async () => {
    const error: unknown = await withUserTx(
      claims(),
      (tx) =>
        tx.execute(
          sql`update platform.persons set display_name_ar = 'ب' where id = ${person}::uuid`,
        ),
      passive,
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgError(error)?.code).toBe('25006');
    const [row] = await owner<{ name: string }[]>`
      select display_name_ar as name from platform.persons where id = ${person}`;
    expect(row?.name).toBe('أ');
  });

  it('never revives an idle session: past the inactivity limit it is refused, and stays so', async () => {
    await lastActive(31); // the default limit is 30 minutes
    const facts = await withUserTx(claims(), (tx) => loadSessionFacts(tx), passive);
    expect(facts.active).toBe(false);
    expect(await idleMinutes()).toBeGreaterThan(30.9);
  });

  it('refuses a name that is not on the list, before any connection', async () => {
    await expect(
      withUserTx(claims(), () => Promise.resolve(1), {
        passiveRead: 'platform.users.list' as never,
      }),
    ).rejects.toThrow('not on the list');
  });
});
