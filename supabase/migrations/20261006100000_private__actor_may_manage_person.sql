-- One answer to "may the signed-in member manage this person's record?" (T-M2-13, FR-IAM-01), used by
-- the person write guard AND by the application (edit buttons, edit page), so both always agree:
-- an active user manager (Organization Admin or HR Manager), and — for the record of a member holding a
-- privileged role — only an Organization Admin (PO decision 5 Oct 2026, as for memberships).
-- Reveals nothing to other members: false whenever the caller manages no users.

create or replace function private.actor_may_manage_person(p_tenant_id uuid, p_person_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.actor_manages_users(p_tenant_id)
     and ('tenant_admin' = any (private.actor_role_codes(p_tenant_id, private.request_user_id()))
          or not exists (select 1 from platform.tenant_memberships m
                         where m.tenant_id = p_tenant_id and m.person_id = p_person_id
                           and private.membership_is_privileged(m.tenant_id, m.id)));
$$;

revoke all on function private.actor_may_manage_person(uuid, uuid) from public;
grant execute on function private.actor_may_manage_person(uuid, uuid) to authenticated;

-- The guard now uses it (same behaviour as 20261006090000).
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
    if private.actor_may_manage_person(new.tenant_id, v_target) then
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

