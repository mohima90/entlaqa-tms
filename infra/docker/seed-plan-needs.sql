-- Submitted needs for the training plan E2E (infra/docker/smoke.sh, WP-LD-02 / T-M3-06): run as postgres after
-- the planning journey left one OPEN cycle in organization sovereign-smoke. Every department of that cycle gets
-- the same two needs and is marked submitted, as if each head had entered and sent them — so the L&D Manager
-- can «Close needs now» and build the plan (plan-consolidation.spec.ts). The heads' guards (who enters, when)
-- are switched off for this one transaction only: the journeys that enter needs through the product are
-- needs-entry.spec.ts and the database tests. Sample data only; prints the cycle's id.
\set ON_ERROR_STOP on
begin;
alter table tms.plan_needs disable trigger plan_needs_guard;
alter table tms.plan_cycle_departments disable trigger plan_cycle_departments_guard;
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
insert into tms.plan_needs (tenant_id, cycle_id, department_id, topic, people_count, sort_order)
  select d.tenant_id, d.cycle_id, d.department_id, x.topic, x.people, x.ord
  from tms.plan_cycle_departments d
  join seed_cycle s on s.tenant_id = d.tenant_id and s.cycle_id = d.cycle_id
  cross join (values ('Excel – advanced formulas', 12, 0), ('Customer negotiation skills', 6, 1)) as x(topic, people, ord);
update tms.plan_cycle_departments d set status = 'submitted', submitted_at = now()
  from seed_cycle s
  where s.tenant_id = d.tenant_id and s.cycle_id = d.cycle_id;
alter table tms.plan_needs enable trigger plan_needs_guard;
alter table tms.plan_cycle_departments enable trigger plan_cycle_departments_guard;
select cycle_id from seed_cycle;
commit;
