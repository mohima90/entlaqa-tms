/**
 * People reads through the real authorization pipeline (T-M2-04a, ADR 0003 §4) against PostgreSQL:
 * roles from `platform.role_assignments` (loadGrants), the person resolver (resolveResource) and
 * withUserTx as app_server. For every role, the users list (scope filter in SQL) and the single-person
 * check (authorize() over the resolved person) must agree — the list never shows someone whose profile
 * would be refused, and the other way round.
 */
import { randomUUID } from 'node:crypto';
import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { createDatabase, createWithUserTx, listUsers } from '@jadarat/platform-db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDefineQuery } from './define-query';
import { defaultActionRuntime } from './default-runtime';
import { personScopeFromGrants } from './person-scope';
import { platformPermissions } from './platform-permissions';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

const read = platformPermissions['platform.user.read'];

describe.skipIf(!configured)('people reads through defineQuery against PostgreSQL', () => {
  const ownerDb = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);

  const id = () => randomUUID();
  const tenant = id();
  const otherTenant = id();
  const dept = { training: id(), academy: id(), finance: id() };
  const member = (role: string | null) => ({ person: id(), user: id(), session: id(), role });
  // head heads "training" (which contains "academy"); lead manages report1, who manages report2.
  const people = {
    admin: member('tenant_admin'),
    head: member('department_head'),
    lead: member('line_manager'),
    learner: member('learner'),
    coordinator: member('training_coordinator'),
    report1: member(null),
    report2: member(null),
    unplaced: member(null),
  };
  const outsider = member('tenant_admin');
  const all = [...Object.values(people), outsider];

  const queriesFor = (m: ReturnType<typeof member>, tenantId = tenant) => {
    const defineQuery = createDefineQuery({
      ...defaultActionRuntime,
      getClaims: () => {
        const claims = brandVerifiedClaims({
          sub: m.user,
          role: 'authenticated',
          aal: 'aal1',
          session_id: m.session,
          tenant_id: tenantId,
          person_id: m.person,
        });
        if (!claims.ok) throw new Error('bad fixture');
        return Promise.resolve(ok(claims.value));
      },
      withUserTx: (claims, fn) => withUserTx(claims, fn),
    });
    return {
      list: defineQuery({
        permission: read,
        input: z.object({}),
        scoped: true,
        handler: async ({ ctx }) => {
          const users = await listUsers(ctx.tx, {
            scope: personScopeFromGrants(ctx.grants, read),
            actorPersonId: ctx.actor.personId,
            tab: 'all',
            includeRoles: false,
            limit: 100,
            offset: 0,
          });
          return ok(users.rows.map((r) => r.personId));
        },
      }),
      profile: defineQuery({
        permission: read,
        input: z.object({ personId: z.uuid() }),
        resource: (input) => ({ type: 'person', id: input.personId }),
        handler: ({ input }) => Promise.resolve(ok(input.personId)),
      }),
    };
  };

  beforeAll(async () => {
    const run = (query: ReturnType<typeof sql>) => ownerDb.execute(query);
    await run(sql`insert into platform.tenants (id, slug, name_ar, status) values
      (${tenant}, ${`q-a-${tenant.slice(0, 8)}`}, 'أ', 'active'),
      (${otherTenant}, ${`q-b-${otherTenant.slice(0, 8)}`}, 'ب', 'active')`);
    for (const [index, m] of all.entries()) {
      const tenantId = m === outsider ? otherTenant : tenant;
      await run(
        sql`insert into auth.users (id, email) values (${m.user}, ${`${m.user}@example.test`})`,
      );
      await run(sql`insert into auth.sessions (id, user_id) values (${m.session}, ${m.user})`);
      await run(sql`insert into platform.persons (id, tenant_id, display_name_ar)
        values (${m.person}, ${tenantId}, ${`شخص ${index}`})`);
      await run(sql`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
        values (${tenantId}, ${m.user}, ${m.person}, 'active')`);
      await run(sql`insert into platform.session_context (session_id, user_id, active_tenant_id)
        values (${m.session}, ${m.user}, ${tenantId})`);
      if (m.role) {
        await run(sql`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
          select tenant_id, id, ${m.role}, true from platform.tenant_memberships where user_id = ${m.user}`);
      }
    }
    await run(sql`insert into platform.departments (id, tenant_id, code, name_ar, head_person_id) values
      (${dept.training}, ${tenant}, 'TRN', 'التدريب', ${people.head.person}),
      (${dept.finance}, ${tenant}, 'FIN', 'المالية', null)`);
    await run(sql`insert into platform.departments (id, tenant_id, code, name_ar, parent_id)
      values (${dept.academy}, ${tenant}, 'ACD', 'الأكاديمية', ${dept.training})`);
    const employ = (m: ReturnType<typeof member>, department: string, manager: string | null) =>
      run(sql`insert into platform.person_employment (tenant_id, person_id, department_id, manager_person_id)
        values (${tenant}, ${m.person}, ${department}, ${manager})`);
    await employ(people.head, dept.training, null);
    await employ(people.lead, dept.finance, null);
    await employ(people.report1, dept.academy, people.lead.person);
    await employ(people.report2, dept.finance, people.report1.person);
    await employ(people.learner, dept.training, people.lead.person);
  });

  afterAll(async () => {
    const run = (query: ReturnType<typeof sql>) => ownerDb.execute(query);
    for (const tenantId of [tenant, otherTenant]) {
      await run(sql`delete from platform.person_employment where tenant_id = ${tenantId}`);
      await run(
        sql`delete from platform.departments where tenant_id = ${tenantId} and parent_id is not null`,
      );
      await run(sql`delete from platform.departments where tenant_id = ${tenantId}`);
      await run(sql`delete from platform.session_context where active_tenant_id = ${tenantId}`);
      // Removing the whole membership (with its roles) is allowed, also for the last admin.
      await run(sql`delete from platform.tenant_memberships where tenant_id = ${tenantId}`);
      await run(sql`delete from platform.persons where tenant_id = ${tenantId}`);
    }
    for (const m of all) await run(sql`delete from auth.users where id = ${m.user}`);
    await ownerDb.$client.end();
    await serverDb.$client.end();
  });

  const inTenant = Object.values(people);
  const expected: Record<keyof typeof people, (typeof people)[keyof typeof people][]> = {
    admin: inTenant,
    coordinator: inTenant,
    head: [people.head, people.learner, people.report1],
    lead: [people.report1, people.learner],
    learner: [people.learner],
    report1: [],
    report2: [],
    unplaced: [],
  };

  it.each(Object.keys(expected) as (keyof typeof people)[])(
    '%s: the list and the single-person check cover exactly the same people',
    async (key) => {
      const { list, profile } = queriesFor(people[key]);
      const listed = await list({});
      const want = expected[key].map((m) => m.person).sort();
      if (want.length === 0) {
        // No user.read grant at all (no role): 403 for the list.
        expect(!listed.ok && listed.error.code).toBe('FORBIDDEN');
      } else {
        expect(listed.ok && [...listed.value].sort()).toEqual(want);
      }
      for (const target of inTenant) {
        const result = await profile({ personId: target.person });
        const allowed = want.includes(target.person);
        expect(
          result.ok ? 'ok' : result.error.code,
          `${key} → profile of ${Object.entries(people).find(([, m]) => m === target)?.[0]}`,
        ).toBe(allowed ? 'ok' : want.length === 0 ? 'FORBIDDEN' : 'NOT_FOUND');
      }
    },
  );

  it('another organization’s person is not found, even for an Organization Admin', async () => {
    const { profile } = queriesFor(people.admin);
    const result = await profile({ personId: outsider.person });
    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    const { list } = queriesFor(outsider, otherTenant);
    const listed = await list({});
    expect(listed.ok && listed.value).toEqual([outsider.person]);
  });
});
