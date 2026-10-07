-- Rollback of 20261010090000_private__role_separation_of_duties.sql: no separation-of-duties guards;
-- the invitation link check as in 20261009090000 (owner invitation_guard and grants are kept).
grant invitation_guard to current_user;

create or replace function private.invitation_inviter_may_grant(p_tenant_id uuid, p_invited_by uuid, p_roles text[])
returns boolean
language sql stable
set search_path = ''
as $$
  with inviter as (
    select coalesce(array_agg(ra.role_code), '{}') as codes
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    where ra.tenant_id = p_tenant_id and m.user_id = p_invited_by and m.status = 'active'
      and (ra.valid_from is null or ra.valid_from <= now())
      and (ra.valid_until is null or ra.valid_until > now()))
  select 'tenant_admin' = any (i.codes)
         or ('hr_manager' = any (i.codes)
             and not exists (select 1 from platform.ref_roles r where r.code = any (p_roles) and r.is_privileged))
  from inviter i;
$$;

drop trigger invitations_separation_of_duties on platform.invitations;
drop function private.check_invitation_separation();
drop trigger role_assignments_separation_of_duties on platform.role_assignments;
drop function private.check_role_separation();
drop function private.separation_of_duties_violations();
drop function private.role_windows_overlap(timestamptz, timestamptz, timestamptz, timestamptz);
drop function private.roles_include_exclusive_pair(text[]);
drop function private.exclusive_role(text);
