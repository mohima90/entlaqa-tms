-- Rollback of 20261020210000_private__structure_write_guards.sql: the write policies of 20261004120100 /
-- 20261004120200 again (the server actions alone keep other members out).
drop policy branches_update on platform.branches;
drop policy branches_insert on platform.branches;
create policy branches_insert on platform.branches for insert to authenticated with check (true);
create policy branches_update on platform.branches for update to authenticated using (true) with check (true);

drop policy departments_update on platform.departments;
drop policy departments_insert on platform.departments;
create policy departments_insert on platform.departments for insert to authenticated with check (true);
create policy departments_update on platform.departments for update to authenticated using (true) with check (true);

drop trigger departments_guard_writer on platform.departments;
drop function private.check_department_writer();
drop function private.actor_may_hand_over_heads(uuid);
