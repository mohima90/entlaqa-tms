-- Submitted needs for the training plan E2E (infra/docker/smoke.sh, WP-LD-02 / T-M3-06): run as postgres after
-- the planning journey left one OPEN cycle in organization sovereign-smoke. Every department of that cycle without
-- a need gets the same two needs, the Excel need names the department's effective head (so the plan's Excel line has
-- a planned participant to place: plan-to-sessions.spec.ts, WP-LD-04 review L8), and every department is marked
-- submitted by its effective head — as if each head had entered and sent them — so the L&D Manager can «Close needs
-- now» and build the plan (plan-consolidation.spec.ts). Sample data only; prints the cycle's id.
--
-- Why three guards are switched off, each for ONE statement (review L8): the needs, named-people and submission
-- guards accept a head acting through the web app only — private.may_submit_plan_needs needs the request's verified claims, and
-- private.current_tenant_id() answers them only for session_user app_server with a live Auth session of that
-- head in this organization (private.session_access). This script runs as postgres with no signed-in head, so the
-- real path cannot be taken from here (faking Auth sessions would bypass more than these three guards). What the
-- guards would have written is written the same way: the submission stamps (submitted_at, submitted_by = the
-- department's effective head, private.plan_department_head) and no return. The journeys that enter and submit
-- needs through the product, with every guard on, are needs-entry.spec.ts, the database tests
-- (99_planning_d_needs_*, 99_planning_f_plan_*) and the integration tests.
\set ON_ERROR_STOP on
begin;
create temporary table seed_cycle on commit drop as
  select c.tenant_id, c.id as cycle_id
  from tms.plan_cycles c join platform.tenants t on t.id = c.tenant_id
  where t.slug = 'sovereign-smoke' and c.status = 'open';
do $$
begin
  if (select count(*) from seed_cycle) <> 1 then
    raise exception 'expected exactly one open cycle in sovereign-smoke';
  end if;
end
$$;
create temporary table seed_departments on commit drop as
  select d.tenant_id, d.cycle_id, d.department_id, private.plan_department_head(d.tenant_id, d.department_id) as head
  from tms.plan_cycle_departments d
  join seed_cycle s on s.tenant_id = d.tenant_id and s.cycle_id = d.cycle_id;

-- Two needs for each department that has none yet (the head's entry, without its signed-in session).
alter table tms.plan_needs disable trigger plan_needs_guard;
insert into tms.plan_needs (tenant_id, cycle_id, department_id, topic, people_count, sort_order)
  select d.tenant_id, d.cycle_id, d.department_id, x.topic, x.people, x.ord
  from seed_departments d
  cross join (values ('Excel – advanced formulas', 12, 0), ('Customer negotiation skills', 6, 1)) as x(topic, people, ord)
  where not exists (select 1 from tms.plan_needs n
                    where n.tenant_id = d.tenant_id and n.cycle_id = d.cycle_id and n.department_id = d.department_id);
alter table tms.plan_needs enable trigger plan_needs_guard;

-- The Excel need names one person: the department's effective head (the head's entry, without its signed-in session).
alter table tms.plan_need_people disable trigger plan_need_people_guard;
insert into tms.plan_need_people (tenant_id, need_id, department_id, person_id)
  select d.tenant_id, n.id, d.department_id, d.head
  from seed_departments d
  join tms.plan_needs n on n.tenant_id = d.tenant_id and n.cycle_id = d.cycle_id and n.department_id = d.department_id
                       and n.topic = 'Excel – advanced formulas'
  where d.head is not null
  on conflict do nothing;
alter table tms.plan_need_people enable trigger plan_need_people_guard;
do $$
begin
  if not exists (select 1 from tms.plan_need_people p join seed_cycle s on s.tenant_id = p.tenant_id
                 join tms.plan_needs n on n.tenant_id = p.tenant_id and n.id = p.need_id and n.cycle_id = s.cycle_id
                 where n.topic = 'Excel – advanced formulas') then
    raise exception 'expected at least one person named for the Excel need';
  end if;
end
$$;

-- Submitted by the department's effective head, stamped as the guard stamps a submission.
alter table tms.plan_cycle_departments disable trigger plan_cycle_departments_guard;
update tms.plan_cycle_departments d
  set status = 'submitted', submitted_at = now(), submitted_by = s.head,
      returned_at = null, returned_by = null, return_note = null
  from seed_departments s
  where s.tenant_id = d.tenant_id and s.cycle_id = d.cycle_id and s.department_id = d.department_id;
alter table tms.plan_cycle_departments enable trigger plan_cycle_departments_guard;

select cycle_id from seed_cycle;
commit;
