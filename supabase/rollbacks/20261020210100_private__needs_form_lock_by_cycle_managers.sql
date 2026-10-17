-- Rollback of 20261020210100_private__needs_form_lock_by_cycle_managers.sql: the guard of 20261020180200
-- again (any signed-in member may lock a form).
create or replace function private.check_needs_form()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.check_needs_form_actor(new.tenant_id);
    if current_user = 'authenticated' then
      new.locked_at := null;  -- a form is locked by a cycle's launch only
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform private.check_needs_form_actor(old.tenant_id);
    if old.is_default then
      raise exception 'the default needs form cannot be deleted' using errcode = 'JN003';
    end if;
    if old.locked_at is not null then
      raise exception 'this needs form is used by a launched planning cycle and cannot be deleted' using errcode = 'JN001';
    end if;
    return old;
  end if;
  if (new.id, new.tenant_id) is distinct from (old.id, old.tenant_id) then
    raise exception 'the id and organization of a needs form cannot change' using errcode = 'insufficient_privilege';
  end if;
  if old.locked_at is not null and new.locked_at is distinct from old.locked_at then
    if current_user = 'authenticated' then
      raise exception 'a locked needs form stays locked; duplicate it to change it' using errcode = 'JN001';
    end if;
  elsif old.locked_at is null and new.locked_at is not null then
    new.locked_at := now();
    -- Locking alone (the cycle launch, private.lock_needs_form): any signed-in member; anything else with it
    -- needs the designer's permission.
    if (to_jsonb(new) - 'locked_at') = (to_jsonb(old) - 'locked_at') then
      return new;
    end if;
  end if;
  perform private.check_needs_form_actor(new.tenant_id);
  return new;
end
$$;

comment on function private.check_needs_form() is
  'SECURITY-RELEVANT (T-M3-10). Who changes needs forms; the default and locked forms are not deleted; locks are one-way.';

revoke all on function private.check_needs_form() from public;

comment on function private.lock_needs_form(uuid) is
  'Locks a needs form for good (T-M3-10): called by the planning cycle launch (T-M3-04) in its transaction. True when the form (of the caller''s organization) is locked afterwards; false when it is unknown.';
