-- Bulk user import (FR-IAM-04) × names that follow the organization's default language (guided-test
-- feedback #2, PO 17 Oct 2026; WP-FIX-01 review finding 2): the review's «what changes» named the current and
-- the new direct manager by their Arabic display name only. A manager with an English name only (allowed
-- since 20261021090000) then read as no manager — and a change TO such a manager was not listed at all (a
-- NULL «to» is dropped). Now the Arabic display name, else the English one, in both places. Everything else
-- is as in 20261016090200; the function keeps its owner (the migration role) and its grants.

-- What an update of this person would change: [{"f": field, "from": text, "to": text}] for every field
-- the file gives (an empty cell never clears a value) that differs from the record. Departments, branches
-- and managers are named (Arabic names; a manager without one by the English name), not by id.
create or replace function private.user_import_changes(p_tenant_id uuid, p_person_id uuid, p_data jsonb,
                                                       p_department_id uuid, p_branch_id uuid,
                                                       p_manager_person_id uuid, p_manager_email text)
returns jsonb
language sql stable
set search_path = ''
as $$
  with p as (select * from platform.persons where tenant_id = p_tenant_id and id = p_person_id),
       e as (select * from platform.person_employment where tenant_id = p_tenant_id and person_id = p_person_id),
       f(ord, field, current_value, file_value) as (
         select 1, 'first_name_ar', (select first_name_ar from p), p_data ->> 'first_name_ar'
         union all select 2, 'father_name_ar', (select father_name_ar from p), p_data ->> 'father_name_ar'
         union all select 3, 'grandfather_name_ar', (select grandfather_name_ar from p), p_data ->> 'grandfather_name_ar'
         union all select 4, 'family_name_ar', (select family_name_ar from p), p_data ->> 'family_name_ar'
         union all select 5, 'first_name_en', (select first_name_en from p), p_data ->> 'first_name_en'
         union all select 6, 'father_name_en', (select father_name_en from p), p_data ->> 'father_name_en'
         union all select 7, 'grandfather_name_en', (select grandfather_name_en from p), p_data ->> 'grandfather_name_en'
         union all select 8, 'family_name_en', (select family_name_en from p), p_data ->> 'family_name_en'
         union all select 9, 'mobile', (select mobile_e164 from p), p_data ->> 'mobile'
         union all select 10, 'employee_number', (select employee_number from p), p_data ->> 'employee_number'
         union all select 11, 'job_title_ar', (select job_title_ar from e), p_data ->> 'job_title_ar'
         union all select 12, 'job_title_en', (select job_title_en from e), p_data ->> 'job_title_en'
         union all select 13, 'department',
           (select d.name_ar from e join platform.departments d on d.tenant_id = e.tenant_id and d.id = e.department_id),
           case when p_department_id is distinct from (select department_id from e)
                then (select d.name_ar from platform.departments d where d.tenant_id = p_tenant_id and d.id = p_department_id) end
         union all select 14, 'branch',
           (select b.name_ar from e join platform.branches b on b.tenant_id = e.tenant_id and b.id = e.branch_id),
           case when p_branch_id is distinct from (select branch_id from e)
                then (select b.name_ar from platform.branches b where b.tenant_id = p_tenant_id and b.id = p_branch_id) end
         union all select 15, 'manager',
           (select coalesce(m.display_name_ar, m.display_name_en)
            from e join platform.persons m on m.tenant_id = e.tenant_id and m.id = e.manager_person_id),
           case when p_manager_person_id is not null and p_manager_person_id is distinct from (select manager_person_id from e)
                  then (select coalesce(m.display_name_ar, m.display_name_en)
                        from platform.persons m where m.tenant_id = p_tenant_id and m.id = p_manager_person_id)
                when p_manager_person_id is null and p_manager_email is not null then p_manager_email end
         union all select 16, 'hire_date', (select hire_on::text from e), p_data ->> 'hire_date')
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('f', f.field, 'from', f.current_value, 'to', f.file_value))
                            order by f.ord), '[]'::jsonb)
  from f
  where f.file_value is not null and f.file_value is distinct from f.current_value;
$$;
revoke all on function private.user_import_changes(uuid, uuid, jsonb, uuid, uuid, uuid, text) from public;
grant execute on function private.user_import_changes(uuid, uuid, jsonb, uuid, uuid, uuid, text) to authenticated;
