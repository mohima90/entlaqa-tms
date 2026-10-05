/**
 * Integration tests against real PostgreSQL with the migrations applied (scripts/db-test.sh with
 * DB_TEST_INTEGRATION=1, and the CI `db` job). They prove the TypeScript paths (withUserTx as
 * app_server, withSystemTx as app_worker) apply RLS and claim validation exactly like the SQL tests,
 * and that pooled connections do not leak role or claims.
 */
import { randomUUID } from 'node:crypto';
import { actorFromClaims, hasTenant } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { insertAuditEvent } from './audit';
import { createWithSystemTx } from './jobs';
import { auditEvents, persons, tenantMemberships } from './schema';
import { loadMemberAuthorizationFacts } from './roles';
import { getCurrentTenant } from './tenants';
import { createWithUserTx, listSessionTenants, switchActiveTenant } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const appWorkerUrl = process.env.TEST_APP_WORKER_URL;
const configured = Boolean(ownerUrl && appServerUrl && appWorkerUrl);

// Never skip silently when integration tests were requested (CI db job, scripts/db-test.sh).
if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL, TEST_APP_SERVER_URL and TEST_APP_WORKER_URL must be set');
}

/** SQLSTATE of a postgres.js error, also when wrapped by Drizzle (DrizzleQueryError.cause). */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = cause;
  }
  return undefined;
}

async function expectSqlState(promise: Promise<unknown>, state: string): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, `expected SQLSTATE ${state}, but the statement succeeded`).toBeDefined();
  expect(sqlState(error)).toBe(state);
}

describe.skipIf(!configured)('withUserTx / withSystemTx against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 1, onnotice: () => undefined });
  // max: 1 guarantees the same backend connection is reused across transactions.
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const workerDb = createDatabase(appWorkerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSystemTx = createWithSystemTx(() => workerDb);
  const systemTxOnServerConnection = createWithSystemTx(() => serverDb);

  const ids = {
    tenantA: randomUUID(),
    tenantB: randomUUID(),
    user: randomUUID(),
    session: randomUUID(),
    personA: randomUUID(),
    personB: randomUUID(),
    // A second user, active in tenant B only (the victim-side of the claims-leak test).
    userB: randomUUID(),
    sessionB: randomUUID(),
    personUserB: randomUUID(),
    // A tenant A person without a membership yet (invitation tests).
    personInvitee: randomUUID(),
  };

  const claimsFor = (tenantId?: string) => {
    const result = brandVerifiedClaims({
      sub: ids.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: ids.session,
      ...(tenantId ? { tenant_id: tenantId } : {}),
    });
    if (!result.ok) throw new Error('bad fixture');
    return result.value;
  };

  const claimsForUserB = () => {
    const result = brandVerifiedClaims({
      sub: ids.userB,
      role: 'authenticated',
      aal: 'aal1',
      session_id: ids.sessionB,
      tenant_id: ids.tenantB,
      person_id: ids.personUserB,
    });
    if (!result.ok) throw new Error('bad fixture');
    return result.value;
  };

  beforeAll(async () => {
    await owner`insert into auth.users (id, email) values
      (${ids.user}, ${`${ids.user}@example.test`}), (${ids.userB}, ${`${ids.userB}@example.test`})`;
    await owner`insert into auth.sessions (id, user_id) values
      (${ids.session}, ${ids.user}), (${ids.sessionB}, ${ids.userB})`;
    await owner`insert into platform.tenants (id, slug, name_ar, status) values
      (${ids.tenantA}, ${`it-a-${ids.tenantA.slice(0, 8)}`}, 'أ', 'active'),
      (${ids.tenantB}, ${`it-b-${ids.tenantB.slice(0, 8)}`}, 'ب', 'active')`;
    await owner`insert into platform.persons (id, tenant_id, display_name_ar) values
      (${ids.personA}, ${ids.tenantA}, 'شخص أ'), (${ids.personB}, ${ids.tenantB}, 'شخص ب'),
      (${ids.personUserB}, ${ids.tenantB}, 'مستخدم ب'), (${ids.personInvitee}, ${ids.tenantA}, 'مدعو')`;
    await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
      (${ids.tenantA}, ${ids.user}, ${ids.personA}, 'active'),
      (${ids.tenantB}, ${ids.userB}, ${ids.personUserB}, 'active')`;
    // The user manages people in tenant A (HR Manager): invitations are limited to user managers (T-M2-03).
    await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select tenant_id, id, 'hr_manager', true from platform.tenant_memberships
      where tenant_id = ${ids.tenantA} and user_id = ${ids.user}`;
    await owner`insert into platform.session_context (session_id, user_id, active_tenant_id) values
      (${ids.session}, ${ids.user}, ${ids.tenantA}), (${ids.sessionB}, ${ids.userB}, ${ids.tenantB})`;
  });

  afterAll(async () => {
    // audit_events is append-only (trigger): its rows stay in the throwaway test database, so the
    // tenants they reference stay too (deleting them is not needed for isolation between runs).
    await owner`delete from platform.departments where tenant_id in (${ids.tenantA}, ${ids.tenantB})`;
    await owner`delete from platform.session_context where user_id in (${ids.user}, ${ids.userB})`;
    await owner`delete from platform.tenant_memberships where tenant_id in (${ids.tenantA}, ${ids.tenantB})`;
    await owner`delete from platform.persons where tenant_id in (${ids.tenantA}, ${ids.tenantB})`;
    await owner`delete from auth.users where id in (${ids.user}, ${ids.userB})`;
    await owner.end();
    await serverDb.$client.end();
    await workerDb.$client.end();
  });

  it('withUserTx runs as role authenticated under app_server and sees only its tenant', async () => {
    const rows = await withUserTx(claimsFor(ids.tenantA), async (tx) => {
      const [who] = await tx.execute<{ login: string; role: string; tenant: string | null }>(
        sql`select session_user as login, current_user as role, private.current_tenant_id()::text as tenant`,
      );
      expect(who).toEqual({ login: 'app_server', role: 'authenticated', tenant: ids.tenantA });
      return tx.select({ tenantId: persons.tenantId }).from(persons);
    });
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([ids.tenantA]));
  });

  it('rejects writes into another tenant (RLS with check → SQLSTATE 42501)', async () => {
    await expectSqlState(
      withUserTx(claimsFor(ids.tenantA), (tx) =>
        tx.insert(persons).values({ tenantId: ids.tenantB, displayNameAr: 'دخيل' }),
      ),
      '42501',
    );
  });

  it('user managers can invite but cannot create active memberships (42501)', async () => {
    await expectSqlState(
      withUserTx(claimsFor(ids.tenantA), (tx) =>
        tx.insert(tenantMemberships).values({
          tenantId: ids.tenantA,
          userId: ids.userB,
          personId: ids.personInvitee,
          status: 'active',
        }),
      ),
      '42501',
    );
    const invited = await withUserTx(claimsFor(ids.tenantA), (tx) =>
      tx
        .insert(tenantMemberships)
        .values({ tenantId: ids.tenantA, userId: ids.userB, personId: ids.personInvitee })
        .returning({ status: tenantMemberships.status, tenantId: tenantMemberships.tenantId }),
    );
    expect(invited).toEqual([{ status: 'invited', tenantId: ids.tenantA }]);
  });

  it('audit actor fields must match the verified claims; impersonation cannot be forged', async () => {
    await expectSqlState(
      withUserTx(claimsFor(ids.tenantA), (tx) =>
        tx.insert(auditEvents).values({
          tenantId: ids.tenantA,
          actorUserId: ids.user,
          impersonatorUserId: ids.userB,
          action: 'platform.test.forged',
        }),
      ),
      '42501',
    );
  });

  it('reads zero rows without a tenant claim or with a forged tenant claim', async () => {
    expect(await withUserTx(claimsFor(), (tx) => tx.select().from(persons))).toHaveLength(0);
    // The user has no membership in tenant B: a forged tenant_id claim resolves to no tenant.
    expect(
      await withUserTx(claimsFor(ids.tenantB), (tx) => tx.select().from(persons)),
    ).toHaveLength(0);
  });

  it('does not leak role or claims to the next use of a pooled connection', async () => {
    await withUserTx(claimsFor(ids.tenantA), () => Promise.resolve());
    const [state] = await serverDb.execute<{ role: string; claims: string | null }>(
      sql`select current_user as role, nullif(current_setting('request.jwt.claims', true), '') as claims`,
    );
    expect(state).toEqual({ role: 'app_server', claims: null });
  });

  it('app_server has no table privileges outside withUserTx (NOINHERIT → 42501)', async () => {
    await expectSqlState(serverDb.execute(sql`select count(*) from platform.persons`), '42501');
  });

  it('a session-level legacy request.jwt.claim left on a pooled connection never reaches the next transaction', async () => {
    // Attack: some code path runs a SESSION-level SET (survives COMMIT) of the legacy settings that
    // Supabase's auth.jwt()/auth.uid() read first, with the claims of user A in tenant A.
    const leaked = JSON.stringify(claimsFor(ids.tenantA));
    await serverDb.execute(
      sql`select set_config('request.jwt.claim', ${leaked}, false), set_config('request.jwt.claim.sub', ${ids.user}, false)`,
    );
    try {
      // max: 1 → the same backend connection; the leak is really there outside transactions.
      const [before] = await serverDb.execute<{ claim: string }>(
        sql`select current_setting('request.jwt.claim', true) as claim`,
      );
      expect(before?.claim).toBe(leaked);

      // The next unit of work belongs to user B in tenant B.
      const visible = await withUserTx(claimsForUserB(), async (tx) => {
        const [state] = await tx.execute<{
          claim: string;
          sub: string;
          uid: string | null;
          jwtTenant: string | null;
          tenant: string | null;
        }>(sql`select current_setting('request.jwt.claim', true) as claim,
                      current_setting('request.jwt.claim.sub', true) as sub,
                      auth.uid()::text as uid,
                      auth.jwt() ->> 'tenant_id' as "jwtTenant",
                      private.current_tenant_id()::text as tenant`);
        expect(state).toEqual({
          claim: '',
          sub: '',
          uid: ids.userB,
          jwtTenant: ids.tenantB,
          tenant: ids.tenantB,
        });
        return tx.select({ tenantId: persons.tenantId }).from(persons);
      });
      expect(new Set(visible.map((r) => r.tenantId))).toEqual(new Set([ids.tenantB]));

      // Without a tenant claim nothing falls back to the leaked claims.
      expect(await withUserTx(claimsFor(), (tx) => tx.select().from(persons))).toHaveLength(0);
    } finally {
      await serverDb.execute(sql`reset request.jwt.claim`);
      await serverDb.execute(sql`reset request.jwt.claim.sub`);
    }
  });

  it('withSystemTx under app_worker sees exactly its tenant; system claims under app_server see nothing', async () => {
    const actor = { tenantId: ids.tenantA, jobId: 'integration.test' };
    const visible = await withSystemTx(actor, (tx) =>
      tx.select({ tenantId: persons.tenantId }).from(persons),
    );
    expect(new Set(visible.map((r) => r.tenantId))).toEqual(new Set([ids.tenantA]));
    const none = await systemTxOnServerConnection(actor, (tx) => tx.select().from(persons));
    expect(none).toHaveLength(0);
  });

  it('sign-in helpers: session organizations, the current organization and the sign-in audit event', async () => {
    // Before a tenant is selected (no tenant claim): only the session's active memberships.
    expect(await withUserTx(claimsFor(), (tx) => listSessionTenants(tx))).toEqual([
      { tenantId: ids.tenantA, nameAr: 'أ', nameEn: null },
    ]);
    expect(await withUserTx(claimsFor(ids.tenantA), (tx) => getCurrentTenant(tx))).toEqual({
      tenantId: ids.tenantA,
      nameAr: 'أ',
      nameEn: null,
    });
    // A forged tenant claim (no membership in B) resolves to no organization.
    expect(await withUserTx(claimsFor(ids.tenantB), (tx) => getCurrentTenant(tx))).toBeNull();

    const tenantClaims = claimsFor(ids.tenantA);
    if (!hasTenant(tenantClaims)) throw new Error('bad fixture');
    const actor = actorFromClaims(tenantClaims);
    const otherClaims = claimsForUserB();
    if (!hasTenant(otherClaims)) throw new Error('bad fixture');
    await withUserTx(claimsFor(ids.tenantA), (tx) =>
      insertAuditEvent(tx, actor, {
        action: 'platform.auth.signed_in',
        entityType: 'auth_session',
        entityId: ids.session,
        data: { method: 'password', aal: 'aal1' },
      }),
    );
    const [row] = await owner<{ action: string; actor_user_id: string; entity_id: string }[]>`
      select action, actor_user_id, entity_id from platform.audit_events
      where tenant_id = ${ids.tenantA} and action = 'platform.auth.signed_in'`;
    expect(row).toEqual({
      action: 'platform.auth.signed_in',
      actor_user_id: ids.user,
      entity_id: ids.session,
    });
    // The actor must match the verified claims: another user's row (in another tenant) is refused.
    await expectSqlState(
      withUserTx(claimsFor(ids.tenantA), (tx) =>
        insertAuditEvent(tx, actorFromClaims(otherClaims), {
          action: 'platform.auth.signed_in',
        }),
      ),
      '42501',
    );
  });

  it("loads the member's roles and headed departments for grant loading (T-M2-03)", async () => {
    const department = randomUUID();
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, head_person_id)
      values (${department}, ${ids.tenantA}, ${`D-${department.slice(0, 8)}`}, 'قسم', ${ids.personA})`;
    await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary, valid_until)
      select tenant_id, id, r.code, false, r.until
      from platform.tenant_memberships,
           (values ('department_head', null::timestamptz), ('learner', '2030-01-01T00:00:00Z'::timestamptz)) as r (code, until)
      where user_id = ${ids.user} and tenant_id = ${ids.tenantA}`;

    const facts = await withUserTx(claimsFor(ids.tenantA), (tx) =>
      loadMemberAuthorizationFacts(tx),
    );
    expect(facts).toEqual({
      roles: [
        { roleCode: 'department_head', validFrom: null, validUntil: null },
        { roleCode: 'hr_manager', validFrom: null, validUntil: null },
        { roleCode: 'learner', validFrom: null, validUntil: new Date('2030-01-01T00:00:00Z') },
      ],
      headedDepartmentIds: [department],
    });
    // Another member of another tenant sees none of it.
    expect(await withUserTx(claimsForUserB(), (tx) => loadMemberAuthorizationFacts(tx))).toEqual({
      roles: [],
      headedDepartmentIds: [],
    });
  });

  it('switchActiveTenant only switches into tenants with an active membership, for this session', async () => {
    expect(
      await withUserTx(claimsFor(ids.tenantA), (tx) => switchActiveTenant(tx, ids.tenantB)),
    ).toBe(false);
    await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${ids.tenantB}, ${ids.user}, ${ids.personB}, 'active')`;
    expect(
      await withUserTx(claimsFor(ids.tenantA), (tx) => switchActiveTenant(tx, ids.tenantB)),
    ).toBe(true);
    const [row] = await owner<{ active_tenant_id: string }[]>`
      select active_tenant_id from platform.session_context where session_id = ${ids.session}`;
    expect(row?.active_tenant_id).toBe(ids.tenantB);

    // The pre-switch token (tenant A claim) stops working immediately, not at JWT expiry.
    expect(
      await withUserTx(claimsFor(ids.tenantA), (tx) => tx.select().from(persons)),
    ).toHaveLength(0);
    const inB = await withUserTx(claimsFor(ids.tenantB), (tx) =>
      tx.select({ tenantId: persons.tenantId }).from(persons),
    );
    expect(new Set(inB.map((r) => r.tenantId))).toEqual(new Set([ids.tenantB]));
  });
});
