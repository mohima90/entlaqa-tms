/**
 * Deactivate / reactivate (T-M2-09, FR-IAM-05) against PostgreSQL under withUserTx: the responsibilities
 * move first (a report who takes over moves up to the person's own manager), pending invitations are
 * revoked, the person becomes inactive and the membership suspended — the member's sessions in this
 * organization end at once (another organization stays, and so does the login: the access-token hook's
 * rule), the events are written; reactivation brings person and membership back with the same roles; the
 * HR Manager cannot move a privileged report; a privileged member needs an authenticator code; a placement
 * in a deleted department blocks reactivation; a concurrent "make X head of a department" waits for the
 * deactivation and is then refused (lock order); and a concurrent organization switch cannot leave a
 * session behind (review L3).
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import {
  MEMBER_EVENTS,
  deactivateMembership,
  getMemberLifecycleTarget,
  listDirectReports,
  listHeadedDepartments,
  listReplacementCandidates,
  lockMemberLifecycle,
  reactivateMembership,
  reassignDirectReports,
  reassignHeadedDepartments,
  reassignRefusalOf,
  revokePendingInvitationsOf,
} from './deactivation';
import { createWithUserTx } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('deactivate / reactivate against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 1, onnotice: () => undefined });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const serverDb2 = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx2 = createWithUserTx(() => serverDb2);
  const id = () => randomUUID();
  const tenant = id();
  const other = id();
  const member = (role: string, name: string, tenantId = tenant) => ({
    person: id(),
    user: id(),
    session: id(),
    tenant: tenantId,
    role,
    name,
  });
  const admin = member('tenant_admin', 'أ-مدير');
  const hr = member('hr_manager', 'ب-موارد');
  const boss = member('line_manager', 'ت-مدير أعلى');
  const x = member('line_manager', 'ث-سيُعطَّل');
  const r1 = member('learner', 'ج-تابع أول');
  const r2 = member('learner', 'ح-تابع ثان');
  const auditor = member('auditor', 'خ-مدقق');
  const xElsewhere = { ...member('learner', 'د-في منشأة أخرى', other), user: x.user };
  const all = [admin, hr, boss, x, r1, r2, auditor];
  const dept = id();
  const oldDept = id();

  const claimsOf = (m: { user: string; session: string; tenant: string; person: string }) => {
    const r = brandVerifiedClaims({
      sub: m.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: m.session,
      tenant_id: m.tenant,
      person_id: m.person,
    });
    if (!r.ok) throw new Error('bad fixture');
    return r.value;
  };

  beforeAll(async () => {
    for (const t of [tenant, other]) {
      await owner`insert into platform.tenants (id, slug, name_ar, status)
        values (${t}, ${`da-${t.slice(0, 8)}`}, 'أ', 'active')`;
    }
    for (const m of [...all, xElsewhere]) {
      if (m !== xElsewhere) {
        await owner`insert into auth.users (id, email) values (${m.user}, ${`${m.user}@example.test`})`;
      }
      await owner`insert into auth.sessions (id, user_id) values (${m.session}, ${m.user})`;
      await owner`insert into platform.persons (id, tenant_id, display_name_ar, email)
        values (${m.person}, ${m.tenant}, ${m.name}, ${m === x ? `${x.user}@example.test` : null})`;
      if (m === x) {
        // A pending invitation left behind from before x became a member (e.g. provisioning).
        await owner`insert into platform.invitations (tenant_id, person_id, email, locale, primary_role, invited_by)
          values (${tenant}, ${x.person}, ${`${x.user}@example.test`}, 'ar', 'learner', ${admin.user})`;
      }
      await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
        values (${m.tenant}, ${m.user}, ${m.person}, 'active')`;
      await owner`insert into platform.session_context (session_id, user_id, active_tenant_id)
        values (${m.session}, ${m.user}, ${m.tenant})`;
      await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
        select tenant_id, id, ${m.role}, true from platform.tenant_memberships
        where user_id = ${m.user} and tenant_id = ${m.tenant}`;
    }
    // x reports to boss, heads `dept`, manages r1, r2 and the auditor (a privileged member).
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, head_person_id)
      values (${dept}, ${tenant}, 'DX', 'قسم', ${x.person}), (${oldDept}, ${tenant}, 'OLD', 'قسم قديم', null)`;
    await owner`insert into platform.person_employment (tenant_id, person_id, department_id, manager_person_id)
      values (${tenant}, ${x.person}, ${dept}, ${boss.person}),
             (${tenant}, ${r1.person}, ${dept}, ${x.person}),
             (${tenant}, ${r2.person}, ${dept}, ${x.person}),
             (${tenant}, ${auditor.person}, ${oldDept}, ${x.person})`;
  });

  afterAll(async () => {
    await owner`delete from platform.invitations where tenant_id in (${tenant}, ${other})`;
    for (const m of all) await owner`delete from auth.users where id = ${m.user}`;
    await owner`delete from platform.person_employment where tenant_id = ${tenant}`;
    await owner`delete from platform.departments where tenant_id = ${tenant}`;
    await owner`delete from platform.persons where tenant_id in (${tenant}, ${other})`;
    await owner.end();
    await serverDb.$client.end();
    await serverDb2.$client.end();
  });

  it('reads what the screen needs: the person, their responsibilities, who can take over', async () => {
    const view = await withUserTx(claimsOf(admin), async (tx) => ({
      target: await getMemberLifecycleTarget(tx, x.person),
      reports: await listDirectReports(tx, x.person),
      departments: await listHeadedDepartments(tx, x.person),
      candidates: await listReplacementCandidates(tx, x.person),
      own: await getMemberLifecycleTarget(tx, admin.person),
    }));
    expect(view.target).toMatchObject({
      membershipStatus: 'active',
      isSelf: false,
      mayManage: true,
      privileged: false,
      lastAdmin: false,
    });
    expect(view.reports.map((r) => [r.nameAr, r.movable])).toEqual([
      [r1.name, true],
      [r2.name, true],
      [auditor.name, true],
    ]);
    expect(view.departments.map((d) => d.id)).toEqual([dept]);
    // Line managers and department heads, active, never x.
    expect(view.candidates.map((c) => c.nameAr)).toEqual([boss.name]);
    expect(view.own).toMatchObject({ isSelf: true, lastAdmin: true, privileged: true });
    // The HR Manager may not move the privileged report.
    const asHr = await withUserTx(claimsOf(hr), (tx) => listDirectReports(tx, x.person));
    expect(asHr.find((r) => r.id === auditor.person)?.movable).toBe(false);
  });

  it('HR Manager: a privileged report cannot be moved — refused, nothing changed', async () => {
    const outcome = await withUserTx(claimsOf(hr), async (tx) => {
      await lockMemberLifecycle(tx);
      const moved = await reassignDirectReports(tx, x.person, boss.person);
      if (!moved.ok) throw Object.assign(new Error('refused'), { moved });
      return moved;
    }).catch((error: unknown) => (error as { moved?: unknown }).moved ?? error);
    expect(outcome).toEqual({ ok: false, refusal: 'not_allowed' });
    const [stored] = await owner<{ n: number }[]>`
      select count(*)::int as n from platform.person_employment where manager_person_id = ${x.person}`;
    expect(stored?.n).toBe(3);
  });

  it('deactivates: responsibilities moved, invitations revoked, access to this organization ends', async () => {
    const [invitation] = await owner<{ id: string }[]>`
      select id from platform.invitations where person_id = ${x.person} and status = 'pending'`;
    const result = await withUserTx(claimsOf(admin), async (tx) => {
      await lockMemberLifecycle(tx);
      const reports = await reassignDirectReports(tx, x.person, r1.person);
      const departments = await reassignHeadedDepartments(tx, x.person, boss.person);
      const invitations = await revokePendingInvitationsOf(tx, x.person);
      const done = await deactivateMembership(tx, {
        personId: x.person,
        membershipId:
          (await getMemberLifecycleTarget(tx, x.person))?.membershipId ?? 'missing-membership',
      });
      return { reports, departments, invitations, done };
    });
    expect(result).toEqual({
      reports: { ok: true, moved: [r1.person, r2.person, auditor.person] },
      departments: { ok: true, moved: [dept] },
      invitations: [invitation?.id],
      done: { ok: true },
    });
    const [revoked] = await owner<{ status: string; revoked_by: string }[]>`
      select status, revoked_by::text from platform.invitations where person_id = ${x.person}`;
    expect(revoked).toEqual({ status: 'revoked', revoked_by: admin.user });
    const placements = await owner<{ person_id: string; manager_person_id: string | null }[]>`
      select person_id, manager_person_id from platform.person_employment
      where person_id in (${r1.person}, ${r2.person}, ${auditor.person})`;
    const managerOf = Object.fromEntries(placements.map((p) => [p.person_id, p.manager_person_id]));
    // r1 took over the team: it now reports to x's own manager; the others report to r1.
    expect(managerOf).toEqual({
      [r1.person]: boss.person,
      [r2.person]: r1.person,
      [auditor.person]: r1.person,
    });
    const [state] = await owner<
      {
        person: string;
        membership: string;
        head: string;
        sessions_here: number;
        sessions_there: number;
      }[]
    >`
      select (select status from platform.persons where id = ${x.person}) as person,
             (select status from platform.tenant_memberships where person_id = ${x.person}) as membership,
             (select head_person_id::text from platform.departments where id = ${dept}) as head,
             (select count(*)::int from platform.session_context where user_id = ${x.user} and active_tenant_id = ${tenant}) as sessions_here,
             (select count(*)::int from platform.session_context where user_id = ${x.user} and active_tenant_id = ${other}) as sessions_there`;
    expect(state).toEqual({
      person: 'inactive',
      membership: 'suspended',
      head: boss.person,
      sessions_here: 0,
      sessions_there: 1,
    });
    const [event] = await owner<{ n: number }[]>`
      select count(*)::int as n from platform.event_outbox
      where tenant_id = ${tenant} and type = ${MEMBER_EVENTS.deactivated} and subject = ${x.person}
        and actor_type = 'user' and actor_id = ${admin.user}`;
    expect(event?.n).toBe(1);
    // x's own claims in this organization are refused at once; in the other organization they work.
    const here = await withUserTx(claimsOf(x), (tx) =>
      tx.execute<{ t: string | null }>(sql`select private.current_tenant_id() as t`),
    );
    expect(here[0]?.t).toBeNull();
    const there = await withUserTx(claimsOf(xElsewhere), (tx) =>
      tx.execute<{ t: string | null }>(sql`select private.current_tenant_id() as t`),
    );
    expect(there[0]?.t).toBe(other);
    // x's login is still active in the other organization: Auth keeps issuing tokens (T-IAM-40).
    const [rule] = await owner<{ refused: boolean }[]>`
      select private.account_sign_in_refused(${x.user}::uuid) as refused`;
    expect(rule?.refused).toBe(false);
  });

  it('a member who holds a privileged role: refused at AAL1 (review M4), nothing changed', async () => {
    const refused = await withUserTx(claimsOf(admin), async (tx) => {
      const target = await getMemberLifecycleTarget(tx, auditor.person);
      expect(target?.privileged).toBe(true);
      const outcome = await deactivateMembership(tx, {
        personId: auditor.person,
        membershipId: target?.membershipId ?? 'missing-membership',
      });
      // The caller rolls the transaction back on a refusal.
      throw Object.assign(new Error('refused'), { outcome });
    }).catch((error: unknown) => (error as { outcome?: unknown }).outcome ?? error);
    expect(refused).toEqual({ ok: false, refusal: 'step_up_required' });
    const [state] = await owner<{ person: string; membership: string }[]>`
      select p.status as person, m.status as membership
      from platform.persons p join platform.tenant_memberships m on m.person_id = p.id
      where p.id = ${auditor.person}`;
    expect(state).toEqual({ person: 'active', membership: 'active' });
  });

  it('reactivation needs a live placement, then brings person and membership back with their roles', async () => {
    // x's department is deleted meanwhile (only inactive people are placed there now).
    await owner`update platform.person_employment set department_id = ${oldDept} where person_id = ${x.person}`;
    await owner`update platform.person_employment set department_id = null where person_id = ${auditor.person}`;
    await owner`update platform.departments set deleted_at = now() where id = ${oldDept}`;
    const refused = await withUserTx(claimsOf(admin), async (tx) => {
      const outcome = await reactivateMembership(tx, x.person);
      if (!outcome.ok) throw Object.assign(new Error('refused'), { outcome });
      return outcome;
    }).catch((error: unknown) => (error as { outcome?: unknown }).outcome ?? error);
    expect(refused).toEqual({ ok: false, refusal: 'placement_deleted' });
    await owner`update platform.person_employment set department_id = ${dept} where person_id = ${x.person}`;

    const reactivated = await withUserTx(claimsOf(admin), (tx) =>
      reactivateMembership(tx, x.person),
    );
    expect(reactivated).toMatchObject({ ok: true });
    const [state] = await owner<{ person: string; membership: string; roles: string[] }[]>`
      select p.status as person, m.status as membership,
             array(select ra.role_code from platform.role_assignments ra where ra.membership_id = m.id) as roles
      from platform.persons p join platform.tenant_memberships m on m.person_id = p.id
      where p.id = ${x.person}`;
    expect(state).toEqual({ person: 'active', membership: 'active', roles: ['line_manager'] });
    // Not twice; and nobody reactivates an active member.
    const again = await withUserTx(claimsOf(admin), async (tx) => {
      const outcome = await reactivateMembership(tx, x.person);
      if (!outcome.ok) throw Object.assign(new Error('refused'), { outcome });
      return outcome;
    }).catch((error: unknown) => (error as { outcome?: unknown }).outcome ?? error);
    expect(again).toEqual({ ok: false, refusal: 'not_deactivated' });
  });

  it('a concurrent "make X head" waits for the deactivation, then is refused (lock order)', async () => {
    const signal = () => {
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
    };
    // r2 heads nothing yet; the admin deactivates r2 while (another session of) the admin makes r2 head.
    const { promise: held, fire: release } = signal();
    const { promise: locked, fire: lockedNow } = signal();
    const first = withUserTx(claimsOf(admin), async (tx) => {
      await lockMemberLifecycle(tx);
      lockedNow();
      await held;
      const target = await getMemberLifecycleTarget(tx, r2.person);
      const reports = await listDirectReports(tx, r2.person);
      const departments = await listHeadedDepartments(tx, r2.person);
      return {
        reports: reports.length,
        departments: departments.length,
        done: await deactivateMembership(tx, {
          personId: r2.person,
          membershipId: target?.membershipId ?? 'missing-membership',
        }),
      };
    });
    await locked;
    const second = withUserTx2(claimsOf(admin), (tx) =>
      tx.execute(sql`update platform.departments set head_person_id = ${r2.person}::uuid
                     where id = ${dept}::uuid`),
    ).then(
      () => 'saved',
      (error: unknown) => reassignRefusalOf(error),
    );
    let blocked = false;
    try {
      for (let i = 0; i < 100 && !blocked; i += 1) {
        const [waiting] = await owner<{ n: number }[]>`
          select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`;
        blocked = (waiting?.n ?? 0) > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      release();
    }
    expect(blocked).toBe(true);
    expect(await first).toEqual({ reports: 0, departments: 0, done: { ok: true } });
    // After the deactivation committed, r2 is inactive: the head change is refused.
    expect(await second).toBe('owner_invalid');
    const [head] = await owner<{ head: string }[]>`
      select head_person_id::text as head from platform.departments where id = ${dept}`;
    expect(head?.head).toBe(boss.person);
  });

  it('an organization switch in flight cannot leave a session behind (review L3)', async () => {
    const signal = () => {
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
    };
    // r1 signs in again (a new Auth session) and selects this organization while the admin deactivates r1.
    const newSession = id();
    await owner`insert into auth.sessions (id, user_id) values (${newSession}, ${r1.user})`;
    const { promise: held, fire: release } = signal();
    const { promise: switched, fire: switchedNow } = signal();
    const first = withUserTx2(claimsOf({ ...r1, session: newSession }), async (tx) => {
      const [row] = await tx.execute<{ ok: boolean }>(
        sql`select private.switch_active_tenant(${tenant}::uuid) as ok`,
      );
      switchedNow();
      await held;
      return row?.ok;
    });
    await switched;
    const second = withUserTx(claimsOf(admin), async (tx) => {
      await lockMemberLifecycle(tx);
      return deactivateMembership(tx, {
        personId: r1.person,
        membershipId:
          (await getMemberLifecycleTarget(tx, r1.person))?.membershipId ?? 'missing-membership',
      });
    });
    let blocked = false;
    try {
      for (let i = 0; i < 100 && !blocked; i += 1) {
        const [waiting] = await owner<{ n: number }[]>`
          select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`;
        blocked = (waiting?.n ?? 0) > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      release();
    }
    expect(blocked).toBe(true);
    expect(await first).toBe(true);
    expect(await second).toEqual({ ok: true });
    // The deactivation waited for the switch, then ended its session too.
    const [left] = await owner<{ n: number }[]>`
      select count(*)::int as n from platform.session_context
      where user_id = ${r1.user} and active_tenant_id = ${tenant}`;
    expect(left?.n).toBe(0);
  });
});
