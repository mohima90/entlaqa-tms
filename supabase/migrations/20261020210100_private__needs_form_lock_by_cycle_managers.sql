-- A needs form is locked by the launch of a planning cycle only (security review S-L1 of T-M3-10 / T-M3-04;
-- FR-PLN-02, FR-PLN-03). Class: T (guard on tms.needs_forms). PII: none.
--
-- 20261020180200 let ANY signed-in member of the organization set tms.needs_forms.locked_at ("the calling
-- action authorizes it") — so an employee could freeze every form of the library (a nuisance: a locked form
-- is never unlocked). Now locking needs what the launch itself needs, tms.plan_cycle.manage organization-wide
-- (private.may_manage_plan_cycles, the L&D Manager); the launch (private.plan_cycles_guard →
-- private.lock_needs_form) runs with the launching member's claims, who already holds it (plan_cycles_update
-- policy). Locking together with other changes still also needs the designer's permission
-- (tms.needs_form.manage, private.check_needs_form_actor). Platform operations are not subject to it.
-- Otherwise unchanged from 20261020180200.

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
    -- S-L1: locking is the launch's (tms.plan_cycle.manage organization-wide), never any member's.
    if current_user = 'authenticated' and new.tenant_id = private.current_tenant_id()
       and not (private.request_claims() ->> 'role' = 'authenticated'
                and private.may_manage_plan_cycles(new.tenant_id)) then
      raise exception 'a needs form is locked only by launching a planning cycle' using errcode = 'insufficient_privilege';
    end if;
    -- Locking alone (the cycle launch, private.lock_needs_form); anything else with it needs the designer.
    if (to_jsonb(new) - 'locked_at') = (to_jsonb(old) - 'locked_at') then
      return new;
    end if;
  end if;
  perform private.check_needs_form_actor(new.tenant_id);
  return new;
end
$$;

comment on function private.check_needs_form() is
  'SECURITY-RELEVANT (T-M3-10, S-L1). Who changes needs forms; only a planning-cycle manager (the launch) locks one; the default and locked forms are not deleted; locks are one-way.';

revoke all on function private.check_needs_form() from public;

comment on function private.lock_needs_form(uuid) is
  'Locks a needs form for good (T-M3-10): called by the planning cycle launch (T-M3-04) in its transaction; the guard requires tms.plan_cycle.manage (S-L1). True when the form (of the caller''s organization) is locked afterwards; false when it is unknown.';
