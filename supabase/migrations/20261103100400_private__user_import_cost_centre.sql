-- Bulk user import (FR-IAM-04) × the person's cost centre (WP-HR-01; business flow EP-ORG-structure-completion.md
-- §3 A: «each person has one cost centre … on the person's form and in the people bulk import»; PO chose to
-- add it in the same PR, 24 Oct 2026). Class: T. PII: none new (a cost centre code).
--
--   platform.user_import_rows.cost_centre_id   the cost centre the dry run found for the row.
--   private.user_import_mapping_is_valid        allows the field «cost_centre».
--   private.user_import_classify_cost_centres   NEW dry-run step (the job runs it after user_import_classify):
--                                               by code, else by name; inactive / not found / ambiguous are
--                                               warnings; the review's «what changes» shows it.
--   private.user_import_person_before           also the cost centre (what undo restores).
--   private.user_import_write_person            writes / restores the cost centre of the placement.
--   private.user_import_apply_batch             checks the cost centre is still active, writes it with the
--                                               rest of the row (new people: the unit's default when none).
-- Everything else in these functions is as in 20261021090200, 20261016090200 and 20261027100100.
-- Expand only: an import without the column behaves exactly as before. (The application deployed before this
-- migration never maps the column; the application of this change runs the new step only once it exists.)

alter table platform.user_import_rows add column cost_centre_id uuid;
comment on column platform.user_import_rows.cost_centre_id is 'The cost centre the dry run found (WP-HR-01).';
grant update (cost_centre_id) on platform.user_import_rows to authenticated;

create or replace function private.user_import_mapping_is_valid(p_mapping jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select jsonb_typeof(p_mapping) = 'object'
         and not exists (
           select 1 from jsonb_each(p_mapping) e
           where e.key !~ '^(0|[1-9][0-9]?|1[0-9][0-9])$' or jsonb_typeof(e.value) <> 'string'
              or (e.value #>> '{}') <> all (array[
                   'email', 'first_name_ar', 'father_name_ar', 'grandfather_name_ar', 'family_name_ar',
                   'first_name_en', 'father_name_en', 'grandfather_name_en', 'family_name_en', 'mobile',
                   'employee_number', 'job_title_ar', 'job_title_en', 'department', 'branch', 'cost_centre',
                   'manager_email',
                   'hire_date', 'primary_role', 'additional_roles', 'language']))
         and (select count(*) = count(distinct e.value) from jsonb_each(p_mapping) e)
         and exists (select 1 from jsonb_each_text(p_mapping) e where e.value = 'email')
         and ((exists (select 1 from jsonb_each_text(p_mapping) e where e.value = 'first_name_ar')
               and exists (select 1 from jsonb_each_text(p_mapping) e where e.value = 'family_name_ar'))
              or (exists (select 1 from jsonb_each_text(p_mapping) e where e.value = 'first_name_en')
                  and exists (select 1 from jsonb_each_text(p_mapping) e where e.value = 'family_name_en')));
$$;

create or replace function private.user_import_classify_cost_centres(p_import_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := private.user_import_job_tenant();
begin
  -- By code (letter case ignored), else by name (Arabic or English, letter variants, diacritics and case
  -- ignored: private.search_key). One match and active: the row's cost centre. Inactive, not found or two by
  -- that name: a warning, and the person keeps what they have (a new person gets the unit's default).
  update platform.user_import_rows r
  set cost_centre_id = case when x.n = 1 and x.active then x.id end,
      issues = r.issues || case
        when x.n = 1 and x.active then '[]'::jsonb
        when x.n = 1 then private.user_import_issue('COST_CENTRE_INACTIVE', 'w', 'cost_centre',
                                                    jsonb_build_object('name', r.data ->> 'cost_centre'))
        when x.n > 1 then private.user_import_issue('COST_CENTRE_AMBIGUOUS', 'w', 'cost_centre',
                                                    jsonb_build_object('name', r.data ->> 'cost_centre'))
        else private.user_import_issue('COST_CENTRE_NOT_FOUND', 'w', 'cost_centre',
                                       jsonb_build_object('name', r.data ->> 'cost_centre'))
      end
  from (
    select r2.row_number, coalesce(c.n, nm.n, 0) as n, coalesce(c.id, nm.id) as id,
           coalesce(c.active, nm.active, false) as active
    from platform.user_import_rows r2
    left join lateral (
      select count(*) as n, min(cc.id::text)::uuid as id, bool_and(cc.status = 'active') as active
      from platform.cost_centres cc
      where cc.tenant_id = v_tenant and lower(cc.code) = lower(r2.data ->> 'cost_centre')
      having count(*) > 0) c on true
    left join lateral (
      select count(*) as n, min(cc.id::text)::uuid as id, bool_and(cc.status = 'active') as active
      from platform.cost_centres cc
      where cc.tenant_id = v_tenant
        and (private.search_key(cc.name_ar) = private.search_key(r2.data ->> 'cost_centre')
             or private.search_key(cc.name_en) = private.search_key(r2.data ->> 'cost_centre'))
      having count(*) > 0) nm on c.n is null
    where r2.tenant_id = v_tenant and r2.import_id = p_import_id and r2.data ? 'cost_centre') x
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = x.row_number;

  -- What the review shows for a matched person: the cost centre that changes (codes, from / to).
  update platform.user_import_rows r
  set changes = coalesce(r.changes, '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'f', 'cost_centre',
        'from', (select c.code from platform.person_employment e
                 join platform.cost_centres c on c.tenant_id = e.tenant_id and c.id = e.cost_centre_id
                 where e.tenant_id = v_tenant and e.person_id = r.target_person_id),
        'to', (select c.code from platform.cost_centres c where c.tenant_id = v_tenant and c.id = r.cost_centre_id))))
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.target_person_id is not null
    and r.review_kind in ('new', 'existing') and r.cost_centre_id is not null
    and r.cost_centre_id is distinct from (select e.cost_centre_id from platform.person_employment e
                                           where e.tenant_id = v_tenant and e.person_id = r.target_person_id);
end
$$;

comment on function private.user_import_classify_cost_centres(uuid) is
  'The dry run''s cost-centre step of a user import (WP-HR-01): the row''s cost centre by code or name, warnings, the change shown in the review. Run after private.user_import_classify. System claims of the import''s tenant.';
revoke all on function private.user_import_classify_cost_centres(uuid) from public;
grant execute on function private.user_import_classify_cost_centres(uuid) to authenticated;

create or replace function private.user_import_person_before(p_tenant_id uuid, p_person_id uuid, p_data jsonb,
                                                             p_department_id uuid, p_branch_id uuid,
                                                             p_manager_person_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with p as (select * from platform.persons where tenant_id = p_tenant_id and id = p_person_id),
       e as (select * from platform.person_employment where tenant_id = p_tenant_id and person_id = p_person_id),
       f(col, current_value, new_value) as (
         select 'first_name_ar', to_jsonb((select first_name_ar from p)), p_data -> 'first_name_ar'
         union all select 'father_name_ar', to_jsonb((select father_name_ar from p)), p_data -> 'father_name_ar'
         union all select 'grandfather_name_ar', to_jsonb((select grandfather_name_ar from p)), p_data -> 'grandfather_name_ar'
         union all select 'family_name_ar', to_jsonb((select family_name_ar from p)), p_data -> 'family_name_ar'
         union all select 'first_name_en', to_jsonb((select first_name_en from p)), p_data -> 'first_name_en'
         union all select 'father_name_en', to_jsonb((select father_name_en from p)), p_data -> 'father_name_en'
         union all select 'grandfather_name_en', to_jsonb((select grandfather_name_en from p)), p_data -> 'grandfather_name_en'
         union all select 'family_name_en', to_jsonb((select family_name_en from p)), p_data -> 'family_name_en'
         union all select 'mobile_e164', to_jsonb((select mobile_e164 from p)), p_data -> 'mobile'
         union all select 'employee_number', to_jsonb((select employee_number from p)), p_data -> 'employee_number'
         union all select 'job_title_ar', to_jsonb((select job_title_ar from e)), p_data -> 'job_title_ar'
         union all select 'job_title_en', to_jsonb((select job_title_en from e)), p_data -> 'job_title_en'
         union all select 'department_id', to_jsonb((select department_id from e)), to_jsonb(p_department_id)
         union all select 'branch_id', to_jsonb((select branch_id from e)), to_jsonb(p_branch_id)
         union all select 'manager_person_id', to_jsonb((select manager_person_id from e)), to_jsonb(p_manager_person_id)
         -- WP-HR-01: the cost centre the run checked (apply_batch puts it in the data as cost_centre_id).
         union all select 'cost_centre_id', to_jsonb((select cost_centre_id from e)), p_data -> 'cost_centre_id'
         union all select 'hire_on', to_jsonb((select hire_on::text from e)), p_data -> 'hire_date')
  , changed as (
    select f.col, coalesce(f.current_value, 'null'::jsonb) as current_value
    from f
    where f.new_value is not null and f.new_value <> 'null'::jsonb and f.new_value is distinct from f.current_value)
  -- The display names are recomposed from the parts when a part changes: undo puts them back as they were.
  select coalesce(jsonb_object_agg(x.col, x.current_value), '{}'::jsonb)
  from (
    select col, current_value from changed
    union all
    select 'display_name_ar', to_jsonb((select display_name_ar from p))
    where exists (select 1 from changed where col like '%\_name\_ar')
    union all
    select 'display_name_en', coalesce(to_jsonb((select display_name_en from p)), 'null'::jsonb)
    where exists (select 1 from changed where col like '%\_name\_en')) x;
$$;

create or replace function private.user_import_write_person(p_tenant_id uuid, p_person_id uuid, p_values jsonb,
                                                            p_status text default null)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_person platform.persons;
  v_employment_values jsonb := p_values - array['first_name_ar', 'father_name_ar', 'grandfather_name_ar',
    'family_name_ar', 'first_name_en', 'father_name_en', 'grandfather_name_en', 'family_name_en', 'mobile_e164',
    'employee_number'];
  v_person_values jsonb := p_values - array['job_title_ar', 'job_title_en', 'department_id', 'branch_id',
    'manager_person_id', 'hire_on', 'cost_centre_id'];
  v_employment_version integer;
begin
  if v_person_values <> '{}'::jsonb or p_status is not null then
    update platform.persons p
    set first_name_ar = case when v_person_values ? 'first_name_ar' then v_person_values ->> 'first_name_ar' else p.first_name_ar end,
        father_name_ar = case when v_person_values ? 'father_name_ar' then v_person_values ->> 'father_name_ar' else p.father_name_ar end,
        grandfather_name_ar = case when v_person_values ? 'grandfather_name_ar' then v_person_values ->> 'grandfather_name_ar' else p.grandfather_name_ar end,
        family_name_ar = case when v_person_values ? 'family_name_ar' then v_person_values ->> 'family_name_ar' else p.family_name_ar end,
        first_name_en = case when v_person_values ? 'first_name_en' then v_person_values ->> 'first_name_en' else p.first_name_en end,
        father_name_en = case when v_person_values ? 'father_name_en' then v_person_values ->> 'father_name_en' else p.father_name_en end,
        grandfather_name_en = case when v_person_values ? 'grandfather_name_en' then v_person_values ->> 'grandfather_name_en' else p.grandfather_name_en end,
        family_name_en = case when v_person_values ? 'family_name_en' then v_person_values ->> 'family_name_en' else p.family_name_en end,
        mobile_e164 = case when v_person_values ? 'mobile_e164' then v_person_values ->> 'mobile_e164' else p.mobile_e164 end,
        employee_number = case when v_person_values ? 'employee_number' then v_person_values ->> 'employee_number' else p.employee_number end,
        display_name_ar = case when v_person_values ? 'display_name_ar' then v_person_values ->> 'display_name_ar' else p.display_name_ar end,
        display_name_en = case when v_person_values ? 'display_name_en' then v_person_values ->> 'display_name_en' else p.display_name_en end,
        status = coalesce(p_status, p.status)
    where p.tenant_id = p_tenant_id and p.id = p_person_id
    returning * into v_person;
    if v_person.id is null then
      raise exception 'person not found' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
    end if;
    -- Display names follow the parts (only when an Arabic / English part was written and the names were
    -- not given themselves — undo gives them back as they were).
    if v_person_values ?| array['first_name_ar', 'father_name_ar', 'grandfather_name_ar', 'family_name_ar']
       and not v_person_values ? 'display_name_ar' and v_person.first_name_ar is not null then
      update platform.persons p
      set display_name_ar = concat_ws(' ', p.first_name_ar, p.father_name_ar, p.grandfather_name_ar, p.family_name_ar)
      where p.tenant_id = p_tenant_id and p.id = p_person_id
      returning * into v_person;
    end if;
    if v_person_values ?| array['first_name_en', 'father_name_en', 'grandfather_name_en', 'family_name_en']
       and not v_person_values ? 'display_name_en' then
      update platform.persons p
      set display_name_en = nullif(concat_ws(' ', p.first_name_en, p.father_name_en, p.grandfather_name_en, p.family_name_en), '')
      where p.tenant_id = p_tenant_id and p.id = p_person_id
      returning * into v_person;
    end if;
  else
    select * into v_person from platform.persons p where p.tenant_id = p_tenant_id and p.id = p_person_id;
  end if;

  if v_employment_values <> '{}'::jsonb then
    update platform.person_employment e
    set job_title_ar = case when v_employment_values ? 'job_title_ar' then v_employment_values ->> 'job_title_ar' else e.job_title_ar end,
        job_title_en = case when v_employment_values ? 'job_title_en' then v_employment_values ->> 'job_title_en' else e.job_title_en end,
        department_id = case when v_employment_values ? 'department_id' then (v_employment_values ->> 'department_id')::uuid else e.department_id end,
        branch_id = case when v_employment_values ? 'branch_id' then (v_employment_values ->> 'branch_id')::uuid else e.branch_id end,
        manager_person_id = case when v_employment_values ? 'manager_person_id' then (v_employment_values ->> 'manager_person_id')::uuid else e.manager_person_id end,
        hire_on = case when v_employment_values ? 'hire_on' then (v_employment_values ->> 'hire_on')::date else e.hire_on end,
        cost_centre_id = case when v_employment_values ? 'cost_centre_id' then (v_employment_values ->> 'cost_centre_id')::uuid else e.cost_centre_id end
    where e.tenant_id = p_tenant_id and e.person_id = p_person_id
    returning e.version into v_employment_version;
    if v_employment_version is null then
      insert into platform.person_employment (person_id, job_title_ar, job_title_en, department_id, branch_id,
                                              manager_person_id, hire_on, cost_centre_id, source)
      values (p_person_id, v_employment_values ->> 'job_title_ar', v_employment_values ->> 'job_title_en',
              (v_employment_values ->> 'department_id')::uuid, (v_employment_values ->> 'branch_id')::uuid,
              (v_employment_values ->> 'manager_person_id')::uuid, (v_employment_values ->> 'hire_on')::date,
              (v_employment_values ->> 'cost_centre_id')::uuid, 'import')
      returning version into v_employment_version;
    end if;
  else
    select e.version into v_employment_version
    from platform.person_employment e where e.tenant_id = p_tenant_id and e.person_id = p_person_id;
  end if;
  return jsonb_build_object('person', v_person.version, 'employment', v_employment_version);
end
$$;

CREATE OR REPLACE FUNCTION private.user_import_apply_batch(p_import_id uuid, p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := private.user_import_job_tenant();
  v_import record;
  v_mode text;
  v_default_role text;
  v_admin boolean;
  v_may_update boolean;
  v_importer_person uuid;
  v_row platform.user_import_rows;
  d jsonb;
  v_count integer := 0;
  v_last integer;
  v_person uuid;
  v_invitation uuid;
  v_manager uuid;
  v_department uuid;
  v_branch uuid;
  v_cost_centre uuid;
  v_primary text;
  v_additional text[];
  v_warnings jsonb;
  v_values jsonb;
  v_before jsonb;
  v_versions jsonb;
  v_member text;
  v_state text;
  v_constraint text;
  v_message text;
  v_detail text;
  v_code text;
  v_locale text;
begin
  select i.id, i.status, i.options, i.created_by, i.checkpoint into v_import
  from platform.user_imports i where i.id = p_import_id for update;
  if not found or v_import.status <> 'importing' then
    raise exception 'the import is not adding people' using errcode = 'check_violation';
  end if;
  perform private.user_import_lock_tenant(v_tenant);
  if not private.user_import_actor_may_import(v_tenant, v_import.created_by) then
    raise exception 'the importer may no longer import people' using errcode = 'JU001';
  end if;
  v_mode := v_import.options ->> 'existing';
  v_default_role := v_import.options ->> 'defaultRole';
  v_admin := private.member_has_permission(v_tenant, v_import.created_by, 'platform.role.assign_privileged');
  -- Changing records of people already here is editing people (security review M1): read again for every
  -- batch, as the importer's permissions are.
  v_may_update := private.member_has_permission(v_tenant, v_import.created_by, 'platform.user.update');
  select m.person_id into v_importer_person
  from platform.tenant_memberships m where m.tenant_id = v_tenant and m.user_id = v_import.created_by;
  -- The language of new people without one in the file (T-M2-22).
  select s.default_locale into v_locale from platform.tenant_settings s where s.tenant_id = v_tenant;
  v_locale := coalesce(v_locale, 'en');

  for v_row in
    select r.* from platform.user_import_rows r
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.apply_order > v_import.checkpoint
      and r.review_kind in ('new', 'existing') and r.result is null
    order by r.apply_order
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  loop
    v_count := v_count + 1;
    v_last := v_row.apply_order;
    d := v_row.data;
    -- The review's warnings stay with the row (the error report lists them).
    v_warnings := coalesce((select jsonb_agg(i) from jsonb_array_elements(v_row.issues) i where i ->> 's' = 'w'),
                           '[]'::jsonb);
    begin
      if v_row.review_kind = 'new' and v_mode = 'update_only' then
        update platform.user_import_rows r
        set result = 'skipped', result_issues = private.user_import_issue('NEW_SKIPPED_UPDATE_ONLY', 'k')
        where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
      elsif v_row.review_kind = 'existing' and v_mode = 'skip' then
        update platform.user_import_rows r
        set result = 'skipped', result_issues = private.user_import_issue('EXISTING_SKIPPED', 'k')
        where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
      else
        -- References as they are now: the manager added by an earlier row, units not deleted since, a
        -- manager still active. A reference that no longer holds is left empty (warning).
        v_manager := v_row.manager_person_id;
        if v_row.manager_row is not null then
          select m.person_id into v_manager from platform.user_import_rows m
          where m.tenant_id = v_tenant and m.import_id = p_import_id and m.row_number = v_row.manager_row
            and m.result in ('added', 'updated');
        end if;
        if v_manager is not null and not exists (select 1 from platform.persons p
                                                 where p.tenant_id = v_tenant and p.id = v_manager and p.status = 'active') then
          v_manager := null;
        end if;
        if v_manager is null and (v_row.manager_row is not null or v_row.manager_person_id is not null) then
          v_warnings := v_warnings || private.user_import_issue('MANAGER_NOT_FOUND', 'w', 'manager_email',
                                                                jsonb_build_object('email', d ->> 'manager_email'));
        end if;
        v_department := v_row.department_id;
        if v_department is not null and not exists (select 1 from platform.departments x
                                                     where x.tenant_id = v_tenant and x.id = v_department and x.deleted_at is null) then
          v_department := null;
          v_warnings := v_warnings || private.user_import_issue('DEPARTMENT_NOT_FOUND', 'w', 'department',
                                                                jsonb_build_object('name', d ->> 'department'));
        end if;
        v_branch := v_row.branch_id;
        if v_branch is not null and not exists (select 1 from platform.branches x
                                                where x.tenant_id = v_tenant and x.id = v_branch and x.deleted_at is null) then
          v_branch := null;
          v_warnings := v_warnings || private.user_import_issue('BRANCH_NOT_FOUND', 'w', 'branch',
                                                                jsonb_build_object('name', d ->> 'branch'));
        end if;
        -- WP-HR-01: the cost centre the review found, if still active; in the data as cost_centre_id so the
        -- record's before values (undo) and the write carry it. None: a new person gets the unit's default.
        v_cost_centre := v_row.cost_centre_id;
        if v_cost_centre is not null and not exists (select 1 from platform.cost_centres x
                                                     where x.tenant_id = v_tenant and x.id = v_cost_centre
                                                       and x.status = 'active') then
          v_cost_centre := null;
          v_warnings := v_warnings || private.user_import_issue('COST_CENTRE_INACTIVE', 'w', 'cost_centre',
                                                                jsonb_build_object('name', d ->> 'cost_centre'));
        end if;
        d := d - 'cost_centre_id';
        if v_cost_centre is not null then
          d := d || jsonb_build_object('cost_centre_id', v_cost_centre);
        end if;

        if v_row.review_kind = 'new' then
          v_primary := coalesce(d ->> 'primary_role', v_default_role);
          -- One role per person (EP-ROLES, PO 17 Oct 2026): additional roles of a file are not given.
          v_additional := '{}'::text[];
          if v_row.target_person_id is null then
            -- Fresh check: nobody has this e-mail now (e.g. invited by hand since the review).
            if exists (select 1 from platform.persons p where p.tenant_id = v_tenant and p.email = d ->> 'email'
                                                         and p.removed_at is null) then
              raise exception 'changed since the review' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
            end if;
            insert into platform.persons (display_name_ar, display_name_en, first_name_ar, father_name_ar,
                                          grandfather_name_ar, family_name_ar, first_name_en, father_name_en,
                                          grandfather_name_en, family_name_en, email, employee_number, mobile_e164,
                                          preferred_locale)
            values (nullif(concat_ws(' ', d ->> 'first_name_ar', d ->> 'father_name_ar', d ->> 'grandfather_name_ar', d ->> 'family_name_ar'), ''),
                    nullif(concat_ws(' ', d ->> 'first_name_en', d ->> 'father_name_en', d ->> 'grandfather_name_en', d ->> 'family_name_en'), ''),
                    d ->> 'first_name_ar', d ->> 'father_name_ar', d ->> 'grandfather_name_ar', d ->> 'family_name_ar',
                    d ->> 'first_name_en', d ->> 'father_name_en', d ->> 'grandfather_name_en', d ->> 'family_name_en',
                    d ->> 'email', d ->> 'employee_number', d ->> 'mobile', coalesce(d ->> 'language', v_locale))
            returning id into v_person;
            insert into platform.person_employment (person_id, department_id, branch_id, manager_person_id, job_title_ar,
                                                    job_title_en, hire_on, cost_centre_id, source)
            values (v_person, v_department, v_branch, v_manager, d ->> 'job_title_ar', d ->> 'job_title_en',
                    (d ->> 'hire_date')::date, v_cost_centre, 'import');
            v_before := null;
            v_versions := null;
          else
            -- A person without account or invitation (e.g. whose invitation was revoked by hand; never one
            -- removed by an undo — those are not matched): invited again, the record updated from the file
            -- and made active; undo restores it.
            perform 1 from platform.persons p where p.tenant_id = v_tenant and p.id = v_row.target_person_id for update;
            select m.status into v_member from platform.tenant_memberships m
            where m.tenant_id = v_tenant and m.person_id = v_row.target_person_id;
            if v_member is not null
               or exists (select 1 from platform.invitations i
                          where i.tenant_id = v_tenant and i.person_id = v_row.target_person_id and i.status = 'pending')
               or not exists (select 1 from platform.persons p
                              where p.tenant_id = v_tenant and p.id = v_row.target_person_id and p.email = d ->> 'email') then
              raise exception 'changed since the review' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
            end if;
            if not v_may_update then
              raise exception 'the importer may not edit people' using errcode = 'insufficient_privilege';
            end if;
            v_person := v_row.target_person_id;
            v_values := private.user_import_person_before(v_tenant, v_person, d, v_department, v_branch, v_manager);
            v_before := v_values || jsonb_build_object('status', (select p.status from platform.persons p
                                                                   where p.tenant_id = v_tenant and p.id = v_person));
            select coalesce(jsonb_object_agg(k.key, case k.key
                     when 'mobile_e164' then d -> 'mobile' when 'hire_on' then d -> 'hire_date'
                     when 'department_id' then to_jsonb(v_department) when 'branch_id' then to_jsonb(v_branch)
                     when 'manager_person_id' then to_jsonb(v_manager) else d -> k.key end), '{}'::jsonb)
              into v_values
            from jsonb_object_keys(v_values) k(key)
            where k.key not like 'display\_name\_%';
            v_versions := private.user_import_write_person(v_tenant, v_person, v_values, 'active');
          end if;
          -- The trigger makes the importer the inviter (checked: may still invite; no privileged role).
          insert into platform.invitations (person_id, email, locale, primary_role, additional_roles, import_id, mail_held)
          values (v_person, d ->> 'email',
                  coalesce(d ->> 'language', (select p.preferred_locale from platform.persons p
                                              where p.tenant_id = v_tenant and p.id = v_person), v_locale),
                  v_primary, v_additional, p_import_id, true)
          returning id into v_invitation;
          insert into platform.audit_events (action, entity_type, entity_id, data)
          values ('platform.invitation.created', 'invitation', v_invitation::text,
                  jsonb_build_object('personId', v_person, 'primaryRole', v_primary, 'additionalRoles', to_jsonb(v_additional),
                                     'importId', p_import_id, 'held', true, 'reinvited', v_row.target_person_id is not null,
                                     'job', private.request_claims() ->> 'job_id'));
          update platform.user_import_rows r
          set result = 'added', result_issues = v_warnings, person_id = v_person, invitation_id = v_invitation,
              before = v_before, after_versions = v_versions
          where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
        else
          -- An existing member: their data only (never e-mail, roles or account status: PO decisions 4, 5).
          v_person := v_row.target_person_id;
          perform 1 from platform.persons p where p.tenant_id = v_tenant and p.id = v_person for update;
          select m.status into v_member from platform.tenant_memberships m
          where m.tenant_id = v_tenant and m.person_id = v_person;
          if v_member is distinct from 'active' then
            raise exception 'changed since the review' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
          end if;
          if v_person = v_importer_person then
            raise exception 'own record' using errcode = 'JU002', detail = 'OWN_ROW';
          end if;
          if not v_may_update then
            raise exception 'the importer may not edit people' using errcode = 'insufficient_privilege';
          end if;
          -- An HR Manager never changes the record of a member holding a privileged role (TM-0003
          -- T-IAM-18; as «تعديل البيانات»): skipped.
          if not v_admin and exists (select 1 from platform.tenant_memberships m
                                     where m.tenant_id = v_tenant and m.person_id = v_person
                                       and private.membership_is_privileged(m.tenant_id, m.id)) then
            update platform.user_import_rows r
            set result = 'skipped', result_issues = private.user_import_issue('PRIVILEGED_MEMBER', 'k')
            where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
          else
            v_before := private.user_import_person_before(v_tenant, v_person, d, v_department, v_branch, v_manager);
            if v_before = '{}'::jsonb then
              update platform.user_import_rows r
              set result = 'skipped', result_issues = private.user_import_issue('NO_CHANGES', 'k') || v_warnings
              where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
            else
              select coalesce(jsonb_object_agg(k.key, case k.key
                       when 'mobile_e164' then d -> 'mobile' when 'hire_on' then d -> 'hire_date'
                       when 'department_id' then to_jsonb(v_department) when 'branch_id' then to_jsonb(v_branch)
                       when 'manager_person_id' then to_jsonb(v_manager) else d -> k.key end), '{}'::jsonb)
                into v_values
              from jsonb_object_keys(v_before) k(key)
              where k.key not like 'display\_name\_%';
              v_versions := private.user_import_write_person(v_tenant, v_person, v_values, null);
              insert into platform.audit_events (action, entity_type, entity_id, data)
              values ('platform.user.updated', 'person', v_person::text,
                      jsonb_build_object('changed', (select jsonb_agg(k order by k) from jsonb_object_keys(v_before) k
                                                     where k not like 'display\_name\_%'),
                                         'importId', p_import_id, 'job', private.request_claims() ->> 'job_id'));
              update platform.user_import_rows r
              set result = 'updated', result_issues = v_warnings, person_id = v_person, before = v_before,
                  after_versions = v_versions
              where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
            end if;
          end if;
        end if;
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_message = message_text,
                              v_detail = pg_exception_detail;
      v_code := case
        when v_state = 'JU002' then coalesce(nullif(v_detail, ''), 'CHANGED_SINCE_REVIEW')
        when v_state = '23505' and v_constraint = 'persons_tenant_employee_number_uq' then 'EMPLOYEE_NUMBER_TAKEN'
        when v_state = '23505' then 'CHANGED_SINCE_REVIEW'
        when v_state = 'JR001' then 'ROLE_ORG_ADMIN'
        when v_state = '23514' and v_message like '%manager chain%' then 'MANAGER_LOOP'
        when v_state = '23514' and v_message like '%direct manager must be an active person%' then 'MANAGER_NOT_FOUND'
        when v_state = '42501' then 'NOT_ALLOWED'
        when v_state = 'JL001' then 'PEOPLE_LIMIT'
        else 'WRITE_FAILED'
      end;
      update platform.user_import_rows r
      set result = case when v_code = 'OWN_ROW' then 'skipped' else 'failed' end,
          result_issues = private.user_import_issue(v_code, case when v_code = 'OWN_ROW' then 'k' else 'e' end)
      where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
    end;
  end loop;

  if v_count > 0 then
    update platform.user_imports i
    set checkpoint = v_last, rows_done = least(i.rows_total, i.rows_done + v_count)
    where i.id = p_import_id;
  end if;
  return v_count;
end
$function$;
