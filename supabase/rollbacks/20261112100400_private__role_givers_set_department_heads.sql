-- Rollback of 20261112100400_private__role_givers_set_department_heads.sql: a unit's head is written by
-- structure managers and by the hand-over of a leaver's units only (the definitions of
-- 20261020210000_private__structure_write_guards.sql); the two helpers go.
set local lock_timeout = '5s';

drop policy departments_update on platform.departments;
create policy departments_update on platform.departments for update to authenticated
  using (private.actor_may_manage_structure(tenant_id) or private.actor_may_hand_over_heads(tenant_id))
  with check (private.actor_may_manage_structure(tenant_id) or private.actor_may_hand_over_heads(tenant_id));

create or replace function private.check_department_writer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- Stamped by private.stamp_row whatever the request sends.
  v_ignore constant text[] := array['head_person_id', 'created_at', 'created_by', 'updated_at', 'updated_by',
                                    'version'];
begin
  if current_user <> 'authenticated' then
    return new;  -- platform operation
  end if;
  if new.tenant_id is distinct from private.current_tenant_id() then
    return new;  -- another organization's row: the restrictive tenant_isolation policy rejects it
  end if;
  if private.actor_may_manage_structure(new.tenant_id) then
    return new;
  end if;
  if private.actor_may_hand_over_heads(new.tenant_id)
     and old.deleted_at is null
     and old.head_person_id is not null
     and new.head_person_id is not null
     and old.head_person_id is distinct from new.head_person_id
     and old.head_person_id is distinct from private.request_person_id()
     and private.actor_may_manage_person(new.tenant_id, old.head_person_id)
     and (to_jsonb(new) - v_ignore) = (to_jsonb(old) - v_ignore) then
    return new;
  end if;
  raise exception 'only members who manage the organization structure change its units'
    using errcode = 'insufficient_privilege';
end
$$;
comment on function private.check_department_writer() is
  'SECURITY-RELEVANT (EP-ORG, FR-IAM-05; S-M1). Units are changed by structure managers; a deactivating member changes only the head of a leaver''s units.';

revoke all on function private.check_department_writer() from public;

drop function private.person_holds_role_now(uuid, uuid, text);
drop function private.actor_may_give_department_head(uuid);
