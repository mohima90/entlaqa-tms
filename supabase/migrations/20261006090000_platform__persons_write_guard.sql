-- Who may write person records on the request path (TM-0004 F-PEO-01 / T-PEO-08; FR-IAM-01, FR-IAM-16).
-- Until now any member's transaction could insert or update any person (policies `with check (true)`);
-- only application code stopped it. Defence in depth, like the role guards (T-M2-03):
--   · user managers (an active Organization Admin or HR Manager role) write any person and placement;
--   · every member may change their OWN person, but only the personal details of My profile (FR-IAM-16):
--     names AR/EN (parts and display names), mobile and interface language — never e-mail, employee
--     number, status, type or nationality (PO decision 5 Oct 2026: job data stays with HR);
--   · placements (person_employment) only by user managers;
--   · system jobs (HR sync) keep writing; platform operations (migrations, provisioning) are not checked.
-- Rows of another tenant are rejected by the restrictive tenant_isolation policy before this matters.

create or replace function private.actor_manages_users(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.actor_role_codes(p_tenant_id, private.request_user_id())
         && array['tenant_admin', 'hr_manager']::text[];
$$;

revoke all on function private.actor_manages_users(uuid) from public;
grant execute on function private.actor_manages_users(uuid) to authenticated;

-- Columns a member may change on their own person record ([std] columns are stamped by stamp_row).
create or replace function private.person_self_service_columns()
returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array['first_name_ar', 'father_name_ar', 'grandfather_name_ar', 'family_name_ar',
               'first_name_en', 'father_name_en', 'grandfather_name_en', 'family_name_en',
               'display_name_ar', 'display_name_en', 'mobile_e164', 'preferred_locale',
               'updated_at', 'updated_by', 'version']::text[];
$$;

revoke all on function private.person_self_service_columns() from public;
grant execute on function private.person_self_service_columns() to authenticated;

create or replace function private.check_person_writer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := private.request_claims() ->> 'role';
begin
  if current_user <> 'authenticated' then
    return new;  -- platform operation
  end if;
  if new.tenant_id is distinct from private.current_tenant_id() then
    return new;  -- rejected by the restrictive tenant_isolation policy
  end if;
  if v_kind = 'system' then
    return new;  -- system jobs (HR sync) maintain the directory
  end if;
  if v_kind is distinct from 'authenticated' or private.request_user_id() is null then
    raise exception 'unexpected claims for a person change' using errcode = 'insufficient_privilege';
  end if;
  if private.actor_manages_users(new.tenant_id) then
    return new;
  end if;
  if tg_table_name = 'persons' and tg_op = 'UPDATE' then
    if old.id = private.request_person_id()
       and (to_jsonb(new) - private.person_self_service_columns())
         = (to_jsonb(old) - private.person_self_service_columns()) then
      return new;  -- My profile: own personal details only
    end if;
  end if;
  raise exception 'only user managers may change this person record'
    using errcode = 'insufficient_privilege';
end
$$;

revoke all on function private.check_person_writer() from public;
comment on function private.check_person_writer() is
  'SECURITY-RELEVANT (TM-0004 F-PEO-01, T-PEO-08). Database guard for who may write person records.';

create trigger persons_guard_writer before insert or update on platform.persons
  for each row execute function private.check_person_writer();
create trigger person_employment_guard_writer before insert or update on platform.person_employment
  for each row execute function private.check_person_writer();
