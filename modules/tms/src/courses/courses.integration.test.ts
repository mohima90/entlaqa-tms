/**
 * «Add course» against PostgreSQL (WP-UX-01 c, T-M3-21; FR-CAT-01; review finding 1): a course added without a
 * code gets the next free `CRS-` number — skipping a code typed by hand, one held by an archived course, and
 * one taken by a course added at the same moment (two concurrent creates on two connections). The real action
 * definition, the production runtime (grants from role assignments, audit events) and withUserTx as
 * app_server — so the generation's SQL, the unique index on lower(code), row-level security and the course
 * library guard all run. A second organization's codes never count.
 */
import { randomUUID } from 'node:crypto';
import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import {
  type UserTx,
  createDatabase,
  createWithUserTx,
  insertAuditEvent,
  loadMemberAuthorizationFacts,
  loadSessionFacts,
} from '@jadarat/platform-db';
import {
  type ActionRuntime,
  createDefineAction,
  grantsForAssignments,
} from '@jadarat/platform-rbac';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCourseActionDefinition } from './actions';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('automatic course codes against PostgreSQL', () => {
  const ownerDb = createDatabase(ownerUrl ?? '', { max: 1 });
  // Two connections: the two creates run in two transactions at the same time.
  const serverDb = createDatabase(appServerUrl ?? '', { max: 2 });
  const withUserTx = createWithUserTx(() => serverDb);
  const id = () => randomUUID();
  const tenant = id();
  const other = id();
  const lnd = { person: id(), user: id(), session: id(), tenantId: tenant };
  const unexpected: unknown[] = [];

  const runtime: ActionRuntime<UserTx> = {
    loadSessionFacts: (tx) => loadSessionFacts(tx),
    loadGrants: async (tx) => {
      const facts = await loadMemberAuthorizationFacts(tx);
      return grantsForAssignments(
        facts.roles.map((role) => ({ roleCode: role.roleCode })),
        { headedDepartmentIds: facts.headedDepartmentIds, customRoles: facts.customRoles },
      );
    },
    resolveResource: () => Promise.resolve(null),
    writeAudit: (tx, actor, record) => insertAuditEvent(tx, actor, record),
    logError: (error) => {
      unexpected.push(error);
    },
    getClaims: () => {
      const claims = brandVerifiedClaims({
        sub: lnd.user,
        role: 'authenticated',
        aal: 'aal1',
        session_id: lnd.session,
        tenant_id: lnd.tenantId,
        person_id: lnd.person,
      });
      if (!claims.ok) throw new Error('bad fixture');
      return Promise.resolve(ok(claims.value));
    },
    withUserTx: (claims, fn) => withUserTx(claims, fn),
  };
  const create = createDefineAction<UserTx>(runtime)(createCourseActionDefinition());
  const values = (title: string) => ({
    titleEn: title,
    titleAr: '',
    descriptionEn: '',
    descriptionAr: '',
    category: { kind: 'none' as const },
    deliveryType: 'classroom' as const,
    durationHours: 6,
    durationDays: null,
    minParticipants: 1,
    maxParticipants: 20,
    estCostPerSession: null,
    estCostPerParticipant: null,
  });

  beforeAll(async () => {
    const run = (query: ReturnType<typeof sql>) => ownerDb.execute(query);
    await run(sql`insert into platform.tenants (id, slug, name_ar, status) values
      (${tenant}, ${`crs-a-${tenant.slice(0, 8)}`}, 'أ', 'active'),
      (${other}, ${`crs-b-${other.slice(0, 8)}`}, 'ب', 'active')`);
    await run(
      sql`insert into auth.users (id, email) values (${lnd.user}, ${`${lnd.user}@example.test`})`,
    );
    await run(sql`insert into auth.sessions (id, user_id) values (${lnd.session}, ${lnd.user})`);
    await run(sql`insert into platform.persons (id, tenant_id, display_name_ar, display_name_en)
      values (${lnd.person}, ${tenant}, 'مدير التعلم', 'L&D Manager')`);
    await run(sql`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${tenant}, ${lnd.user}, ${lnd.person}, 'active')`);
    await run(sql`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${lnd.session}, ${lnd.user}, ${tenant})`);
    await run(sql`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select tenant_id, id, 'training_manager', true from platform.tenant_memberships
      where user_id = ${lnd.user}`);
    // Two courses already: a code typed by hand that the numbering reaches next (lower case: codes are
    // unique regardless of case), and an archived course that still holds its code.
    await run(sql`insert into tms.courses (tenant_id, code, title_en, delivery_type, duration_hours, max_participants)
      values (${tenant}, 'crs-0003', 'Typed by hand', 'classroom', 2, 10)`);
    await run(sql`insert into tms.courses (tenant_id, code, title_en, delivery_type, duration_hours, max_participants, status)
      values (${tenant}, 'CRS-0004', 'Archived', 'classroom', 2, 10, 'archived')`);
    // Another organization's courses never count, nor do their codes.
    await run(sql`insert into tms.courses (tenant_id, code, title_en, delivery_type, duration_hours, max_participants)
      values (${other}, 'CRS-0005', 'Elsewhere', 'classroom', 2, 10)`);
  });

  afterAll(async () => {
    expect(unexpected).toEqual([]);
    await ownerDb.$client.end();
    await serverDb.$client.end();
  });

  it('skips the codes taken — by hand, by an archived course, by a create at the same moment', async () => {
    // Two courses so far: the numbering starts at 3; 3 and 4 are taken.
    const [first, second] = await Promise.all([
      create(values('Negotiation skills')),
      create(values('Customer service')),
    ]);
    if (!first.ok) throw new Error(first.error.code);
    if (!second.ok) throw new Error(second.error.code);
    expect([first.value.after.code, second.value.after.code].sort()).toEqual([
      'CRS-0005',
      'CRS-0006',
    ]);
    // Then the next one, alone.
    const third = await create(values('Time management'));
    expect(third.ok && third.value.after.code).toBe('CRS-0007');
    // A code sent with the course is kept, and still refused when taken.
    const typed = await create({ ...values('Typed'), code: 'LEAD-101' });
    expect(typed.ok && typed.value.after.code).toBe('LEAD-101');
    const taken = await create({ ...values('Taken'), code: 'crs-0004' });
    expect(!taken.ok && taken.error.fieldErrors).toEqual([{ path: 'code', code: 'CODE_TAKEN' }]);

    const codes = await ownerDb.execute<{ code: string }>(
      sql`select code from tms.courses where tenant_id = ${tenant} order by lower(code)`,
    );
    expect(codes.map((r) => r.code)).toEqual([
      'crs-0003',
      'CRS-0004',
      'CRS-0005',
      'CRS-0006',
      'CRS-0007',
      'LEAD-101',
    ]);
  });
});
