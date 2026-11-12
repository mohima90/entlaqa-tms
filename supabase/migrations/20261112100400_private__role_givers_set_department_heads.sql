-- Whoever gives the Department Head role makes the person the head of their department (WP-FIX-03, T-M3-18;
-- FR-ADM-05, FR-IAM-03/04; PO 12 Nov 2026: «when I add the role Department Head, he becomes the manager of
-- the department according to what his department is» — whoever gives the role, the HR Manager or the
-- Organization Admin; review M2). Class: authorization rule (two helpers, one guard function, one policy; no
-- table or data change). PII: none.
--
-- Until now only structure managers (`platform.org.manage`: the HR Manager) wrote a unit's head, plus the
-- hand-over of a leaver's units (20261020210000). The Organization Admin gives the Department Head role but
-- could not say which department the person heads, so the department stayed «No head». The NARROW addition:
-- a member who may give the Department Head role (private.member_may_give_roles — the rule of the role
-- guard) may write ONLY `head_person_id` of a live unit of their own organization, and only as part of
-- giving or taking that role:
--   * SET or REPLACE the head with a person who is not the actor, whom the actor may manage, and who holds
--     the Department Head role at that moment (the role is written first in the same transaction) or is
--     invited with it (pending invitation); a head who is replaced must be the actor or someone the actor
--     may manage;
--   * CLEAR the head only when the old head is not the actor, the actor may manage them, and they hold the
--     Employee role at that moment (a head made an Employee is asked first, then their units are left
--     without a head).
-- Nothing else of the row may differ; a deleted unit never; another organization never (tenant_isolation).
-- Nobody makes THEMSELVES a head this way, and nobody makes a head of someone without the role.
-- The hand-over of a leaver's units is tightened the same way: the member who deactivates never becomes
-- the new head themselves (second look M3). A STRUCTURE MANAGER (`platform.org.manage`) may still pick
-- themselves as a head in the Departments form — a privileged, audited act (the PO's own example is the HR
-- Manager who heads Human Resources).
-- Expand-first: the previous release never attempts these writes as a non-manager.
set local lock_timeout = '5s';

create or replace function private.actor_may_give_department_head(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and private.member_may_give_roles(p_tenant_id, private.request_user_id(), array['department_head']::text[]);
$$;
comment on function private.actor_may_give_department_head(uuid) is
  'SECURITY-RELEVANT (FR-ADM-05, FR-IAM-04; WP-FIX-03). A signed-in member who may give the Department Head role (private.member_may_give_roles): may set, replace or clear a unit''s head only under the conditions of private.check_department_writer.';

revoke all on function private.actor_may_give_department_head(uuid) from public;
grant execute on function private.actor_may_give_department_head(uuid) to authenticated;

-- Does the person hold `p_role` now (a role in force on a membership that is not revoked)? For the
-- Department Head role a pending invitation with that role counts too: an invited head is the head from the
-- invitation on (EP-ORG).
create or replace function private.person_holds_role_now(p_tenant_id uuid, p_person_id uuid, p_role text)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
           select 1
           from platform.tenant_memberships m
           join platform.role_assignments ra on ra.tenant_id = m.tenant_id and ra.membership_id = m.id
           where m.tenant_id = p_tenant_id and m.person_id = p_person_id and m.status <> 'revoked'
             and ra.role_code = p_role
             and (ra.valid_from is null or ra.valid_from <= now())
             and (ra.valid_until is null or ra.valid_until > now()))
      or (p_role = 'department_head'
          and exists (
            select 1 from platform.invitations i
            where i.tenant_id = p_tenant_id and i.person_id = p_person_id
              and i.status = 'pending' and i.primary_role = p_role));
$$;
comment on function private.person_holds_role_now(uuid, uuid, text) is
  'SECURITY-RELEVANT (WP-FIX-03). The person holds the role now (in force, membership not revoked); for department_head a pending invitation with that role counts. Read with the caller''s rights (RLS).';

revoke all on function private.person_holds_role_now(uuid, uuid, text) from public;
grant execute on function private.person_holds_role_now(uuid, uuid, text) to authenticated;

-- What a member who does not manage the structure may change on a unit: the head hand-over of a leaver's
-- units (20261020210000), and the head that goes with the Department Head role (this migration).
create or replace function private.check_department_writer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- Stamped by private.stamp_row whatever the request sends.
  v_ignore constant text[] := array['head_person_id', 'created_at', 'created_by', 'updated_at', 'updated_by',
                                    'version'];
  v_actor uuid;
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
     -- A deactivating member never takes a leaver's units for themselves (second look M3, 12 Nov 2026:
     -- the head of a unit enters its needs, so a head is no longer something to pick up in passing).
     and new.head_person_id is distinct from private.request_person_id()
     and private.actor_may_manage_person(new.tenant_id, old.head_person_id)
     and (to_jsonb(new) - v_ignore) = (to_jsonb(old) - v_ignore) then
    return new;
  end if;
  -- The head that goes with the Department Head role (WP-FIX-03): only the head, only of a live unit.
  v_actor := private.request_person_id();
  if private.actor_may_give_department_head(new.tenant_id)
     and v_actor is not null
     and old.deleted_at is null
     and new.deleted_at is null
     and old.head_person_id is distinct from new.head_person_id
     and (to_jsonb(new) - v_ignore) = (to_jsonb(old) - v_ignore) then
    if new.head_person_id is not null then
      -- Set or replace: a Department Head (never the actor), whom the actor may manage; a replaced head is
      -- the actor or someone the actor may manage.
      if new.head_person_id is distinct from v_actor
         and private.actor_may_manage_person(new.tenant_id, new.head_person_id)
         and private.person_holds_role_now(new.tenant_id, new.head_person_id, 'department_head')
         and (old.head_person_id is null
              or old.head_person_id = v_actor
              or private.actor_may_manage_person(new.tenant_id, old.head_person_id)) then
        return new;
      end if;
    elsif old.head_person_id is distinct from v_actor
          and private.actor_may_manage_person(new.tenant_id, old.head_person_id)
          and private.person_holds_role_now(new.tenant_id, old.head_person_id, 'learner') then
      -- Clear: the head was made an Employee.
      return new;
    end if;
  end if;
  raise exception 'only members who manage the organization structure change its units'
    using errcode = 'insufficient_privilege';
end
$$;
comment on function private.check_department_writer() is
  'SECURITY-RELEVANT (EP-ORG, FR-IAM-05; S-M1; WP-FIX-03). Units are changed by structure managers; a deactivating member changes only the head of a leaver''s units; a member who may give the Department Head role sets, replaces or clears only the head, for a holder of that role (set / replace) or a head made an Employee (clear), never themselves.';

revoke all on function private.check_department_writer() from public;

-- The row is reachable for the same three kinds of member; what each may change is the trigger's.
drop policy departments_update on platform.departments;
create policy departments_update on platform.departments for update to authenticated
  using (private.actor_may_manage_structure(tenant_id) or private.actor_may_hand_over_heads(tenant_id)
         or private.actor_may_give_department_head(tenant_id))
  with check (private.actor_may_manage_structure(tenant_id) or private.actor_may_hand_over_heads(tenant_id)
              or private.actor_may_give_department_head(tenant_id));
