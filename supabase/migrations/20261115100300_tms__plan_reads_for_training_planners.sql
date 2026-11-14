-- The planning data the training plan is built from, for those who build it (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06,
-- FR-IAM-08 R1 note; test feedback #4, agreed 17 Oct 2026). Class: T (read policies of tms.plan_cycles,
-- tms.plan_cycle_departments, tms.plan_needs, tms.plan_need_people). PII: the people named for a need (person ids),
-- now also read by the planners of that need's department.
--
-- Until now these rows were read by holders of tms.plan_cycle.read / .manage organization-wide (the L&D Manager, the
-- Training Coordinator; S-L3) and by a department's effective head (WP-LD-01). A DEPARTMENT-LIMITED L&D Manager — a
-- custom role limited to «A department» with tms.training_plan.read / .manage — builds the plan for its units
-- (private.training_plan_units, migration 20261115100100), so it now also reads, for those units only:
--   tms.plan_cycles             the cycles in which one of its units takes part (name, period, deadline, currency)
--   tms.plan_cycle_departments  its units' rows: status, envelope (FR-PLN-02), deadline
--   tms.plan_needs              its units' needs
--   tms.plan_need_people        the people named for them
-- Members holding tms.training_plan.read / .manage organization-wide (a custom role whose scope is the organization)
-- read them as the L&D Manager does. Nothing else changes: writes keep their policies and guards (cycles, scope,
-- envelopes and needs forms stay the organization-wide L&D Manager's; needs the head's).
-- Expand-first: the policies only widen; the previous release reads the same rows as before.

drop policy plan_cycles_read on tms.plan_cycles;
create policy plan_cycles_read on tms.plan_cycles for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or (select private.may_read_training_plan((select private.current_tenant_id())))
         or exists (select 1 from tms.plan_cycle_departments d
                    where d.tenant_id = tms.plan_cycles.tenant_id and d.cycle_id = tms.plan_cycles.id
                      and (private.may_submit_plan_needs(d.tenant_id, d.department_id)
                           or d.department_id = any ((select private.training_plan_units((select private.current_tenant_id()), false))::uuid[]))));

drop policy plan_cycle_departments_read on tms.plan_cycle_departments;
create policy plan_cycle_departments_read on tms.plan_cycle_departments for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or (select private.may_read_training_plan((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id)
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), false))::uuid[]));

drop policy plan_needs_read on tms.plan_needs;
create policy plan_needs_read on tms.plan_needs for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or (select private.may_read_training_plan((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id)
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), false))::uuid[]));

drop policy plan_need_people_read on tms.plan_need_people;
create policy plan_need_people_read on tms.plan_need_people for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or (select private.may_read_training_plan((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id)
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), false))::uuid[]));
