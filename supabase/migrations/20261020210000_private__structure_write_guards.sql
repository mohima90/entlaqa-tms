-- Units and branches of the structure are written by structure managers only — in the database too
-- (security review S-M1 of T-M3-02 / T-M3-09; FR-ADM-04, FR-ADM-05; business flow EP-ORG). Class: T (policies
-- and a guard on platform.departments and platform.branches). PII: none.
--
-- Until now the write policies of platform.departments and platform.branches (20261004120100 / 120200) were
-- `true`: only the server actions (defineAction, platform.org.manage) kept other members out. Since units carry
-- the scope of department-limited custom roles (T-M3-09) and the planning cycles' scope (T-M3-04), a member
-- who could write them could widen what they see. Now, as for platform.structure_levels (20261020090000):
--   * insert and update of a unit or a branch need platform.org.manage organization-wide
--     (private.actor_may_manage_structure: the HR Manager; custom roles holding it);
--   * ONE exception, the head hand-over when a member is deactivated (FR-IAM-05, PO decision 12 Oct 2026 —
--     packages/platform-db deactivation.ts reassignHeadedDepartments, run with platform.user.deactivate): a
--     member holding platform.user.deactivate organization-wide may change ONLY head_person_id of a live
--     unit, from a person they may manage (private.actor_may_manage_person — a privileged head only by an
--     Organization Admin), never their own, to another person (the head must be active:
--     private.check_department_refs). Any other column in the same statement is refused
--     (private.check_department_writer, compared on the whole row: new columns are refused by default).
-- Platform operations (migrations, provisioning) are not subject to the rules. System jobs never write the
-- structure (no policy for their claims: private.actor_may_manage_structure needs user claims).
-- Expand-first: the running application already writes units and branches with platform.org.manage only
-- (structure.ts, branches.ts) and hands heads over with platform.user.deactivate (deactivation.ts).

-- May the signed-in member hand over the heads of a leaver's units (platform.user.deactivate org-wide)?
create or replace function private.actor_may_hand_over_heads(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and private.member_has_permission(p_tenant_id, private.request_user_id(), 'platform.user.deactivate');
$$;

comment on function private.actor_may_hand_over_heads(uuid) is
  'SECURITY-RELEVANT (FR-IAM-05, EP-ORG; S-M1). A signed-in member holding platform.user.deactivate organization-wide: may hand over the heads of a leaver''s units (head_person_id only, private.check_department_writer).';

revoke all on function private.actor_may_hand_over_heads(uuid) from public;
grant execute on function private.actor_may_hand_over_heads(uuid) to authenticated;

-- What a member who does not manage the structure may change on a unit: the head hand-over only.
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

-- Fires first (name order): it compares the row as the statement sent it.
create trigger departments_guard_writer before update on platform.departments
  for each row execute function private.check_department_writer();

drop policy departments_insert on platform.departments;
drop policy departments_update on platform.departments;
create policy departments_insert on platform.departments for insert to authenticated
  with check (private.actor_may_manage_structure(tenant_id));
create policy departments_update on platform.departments for update to authenticated
  using (private.actor_may_manage_structure(tenant_id) or private.actor_may_hand_over_heads(tenant_id))
  with check (private.actor_may_manage_structure(tenant_id) or private.actor_may_hand_over_heads(tenant_id));

drop policy branches_insert on platform.branches;
drop policy branches_update on platform.branches;
create policy branches_insert on platform.branches for insert to authenticated
  with check (private.actor_may_manage_structure(tenant_id));
create policy branches_update on platform.branches for update to authenticated
  using (private.actor_may_manage_structure(tenant_id))
  with check (private.actor_may_manage_structure(tenant_id));
