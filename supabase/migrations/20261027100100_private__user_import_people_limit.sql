-- Bulk user import (FR-IAM-04) × the organization's people limit (WP-ADM-06, migration 20261027100000): a
-- row that would take the organization over its plan's people limit fails with its own reason
-- (PEOPLE_LIMIT) instead of the generic write failure; the other rows go on. Everything else is as in
-- 20261021090200.
-- Expand only.

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
                                                    job_title_en, hire_on, source)
            values (v_person, v_department, v_branch, v_manager, d ->> 'job_title_ar', d ->> 'job_title_en',
                    (d ->> 'hire_date')::date, 'import');
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

comment on function private.user_import_apply_batch(uuid, integer) is
  'SECURITY-RELEVANT (FR-IAM-04, T-M2-12; WP-ADM-06). One batch of a user import''s run: adds people with held invitations of the importer and updates existing members'' data, each row checked again. System claims of the import''s tenant.';
revoke all on function private.user_import_apply_batch(uuid, integer) from public;
grant execute on function private.user_import_apply_batch(uuid, integer) to authenticated;
