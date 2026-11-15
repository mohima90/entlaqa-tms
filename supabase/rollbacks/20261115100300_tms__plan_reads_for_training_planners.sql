-- Rollback of 20261115100300_tms__plan_reads_for_training_planners.sql: the read policies of
-- 20261105100100_tms__plan_needs.sql again (planning roles organization-wide, and the department's effective head).

drop policy plan_need_people_read on tms.plan_need_people;
create policy plan_need_people_read on tms.plan_need_people for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id));

drop policy plan_needs_read on tms.plan_needs;
create policy plan_needs_read on tms.plan_needs for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id));

drop policy plan_cycle_departments_read on tms.plan_cycle_departments;
create policy plan_cycle_departments_read on tms.plan_cycle_departments for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id));

drop policy plan_cycles_read on tms.plan_cycles;
create policy plan_cycles_read on tms.plan_cycles for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or exists (select 1 from tms.plan_cycle_departments d
                    where d.tenant_id = tms.plan_cycles.tenant_id and d.cycle_id = tms.plan_cycles.id
                      and private.may_submit_plan_needs(d.tenant_id, d.department_id)));
