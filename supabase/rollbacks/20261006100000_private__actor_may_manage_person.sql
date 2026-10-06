-- Rollback of 20261006100000_private__actor_may_manage_person.sql: the guard as in 20261006090000.
create or replace function private.check_person_writer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := private.request_claims() ->> 'role';
  v_target uuid;
  v_ignore text[];
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
    if tg_table_name = 'persons' then
      v_target := new.id;
    else
      v_target := new.person_id;
    end if;
    if 'tenant_admin' = any (private.actor_role_codes(new.tenant_id, private.request_user_id()))
       or not exists (select 1 from platform.tenant_memberships m
                      where m.tenant_id = new.tenant_id and m.person_id = v_target
                        and private.membership_is_privileged(m.tenant_id, m.id)) then
      return new;
    end if;
    -- An HR Manager on a privileged member's record (also their own): only the self-service path below.
    if not (tg_table_name = 'persons' and tg_op = 'UPDATE' and old.id = private.request_person_id()) then
      raise exception 'only an Organization Admin may change the record of a member with a privileged role'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if tg_table_name = 'persons' and tg_op = 'UPDATE' then
    -- Generated columns are NULL in NEW in a BEFORE trigger: never compare them.
    v_ignore := private.person_self_service_columns() || array(
      select a.attname::text from pg_catalog.pg_attribute a
      where a.attrelid = 'platform.persons'::regclass and a.attgenerated <> '' and not a.attisdropped);
    if old.id = private.request_person_id()
       and (to_jsonb(new) - v_ignore) = (to_jsonb(old) - v_ignore) then
      return new;  -- My profile: own personal details only
    end if;
  end if;
  raise exception 'only user managers may change this person record'
    using errcode = 'insufficient_privilege';
end
$$;

drop function private.actor_may_manage_person(uuid, uuid);
