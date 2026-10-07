-- Separation of duties (BR-IAM-4, FR-IAM-07, T-M2-16; PO decision 7 Oct 2026): one person never holds
-- both the Organization Admin role (tenant_admin, a setup role) and the HR Manager role (hr_manager) in
-- the same organization. Assigning one of them to a holder of the other is refused; so is an invitation
-- that would give both. The rule is per organization: a person is a tenant-scoped record, and a login
-- has at most one membership per organization (tenant_memberships unique (tenant_id, user_id) and
-- (tenant_id, person_id)), so "the same person" = the same membership. The same login may be the
-- Organization Admin of one organization and the HR Manager of another.
--
-- "Holds" follows the validity windows of role_assignments: two rows conflict when their windows
-- overlap from now on — [greatest(now, both starts), least(both ends)) is not empty (open start/end =
-- unbounded). A role that has already ended is history and conflicts with nothing; a hand-over can be
-- scheduled (Organization Admin until 31 Oct, HR Manager from 1 Nov). As time passes a conflict can only
-- disappear, never appear, so checking every write is enough.
--
-- Where it is enforced (defence in depth; the application checks first and maps the refusal):
--   platform.role_assignments  trigger role_assignments_separation_of_duties (BEFORE INSERT OR UPDATE, every
--                              writer: request path, system jobs, invitation acceptance, platform
--                              operations). Race-safe: it takes the per-tenant role lock
--                              (private.lock_tenant_roles, the same advisory lock every role and
--                              membership change takes — READ COMMITTED only) before reading the other
--                              rows, so of two concurrent transactions each adding one of the two roles
--                              the second waits for the first to commit, then sees its row and is refused.
--   platform.invitations       trigger invitations_separation_of_duties (BEFORE INSERT, every writer): an
--                              invitation's roles never change after insert (check_invitation).
--   invitation links           private.invitation_inviter_may_grant (owner invitation_guard) also answers
--                              no for such a pair: the link reads as invalid, the sign-up gate refuses it
--                              and acceptance fails with JI001. (An invitation is accepted only by a
--                              person without a membership, so acceptance cannot combine with existing
--                              roles; the role trigger above refuses it anyway.)
--
-- Error: SQLSTATE JR001 (→ @jadarat/platform-db: role change refusal `role_conflict`, invitation
-- DomainError ROLE_CONFLICT). The message names the rule only (no ids, no personal data).
--
-- Existing data: the migration refuses to run while any membership already holds both roles (overlapping
-- windows) or any PENDING invitation would give both. Nothing is changed or deleted silently: the error
-- gives the counts only; see docs/engineering/db-deploy.md § "Separation of duties (T-M2-16)" for what to
-- do. scripts/sql/verify-deployment.sql checks the same invariant after every deploy.
--
-- No gap between the check and the guards (security review L1): the migration first locks both tables
-- against writes (SHARE ROW EXCLUSIVE: reads go on; inserts, updates and deletes — e.g. of the previous
-- application version still running during the deploy — wait until this transaction commits, when the
-- triggers are in place). The table owner (the migration role) may take the lock; it waits at most the
-- deploy's lock_timeout (scripts/db-deploy.sh, 10 s), then the deploy fails and can be run again.

lock table platform.role_assignments, platform.invitations in share row exclusive mode;

-- ---------------------------------------------------------------------------------------------------
-- Helpers (SECURITY INVOKER, empty search_path)
-- ---------------------------------------------------------------------------------------------------
-- The role that may not be held together with p_role (null: none). The one place that lists the pairs;
-- packages/platform-rbac EXCLUSIVE_ROLE_PAIRS mirrors it (drift test in separation-of-duties.test.ts).
create or replace function private.exclusive_role(p_role text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_role
           when 'tenant_admin' then 'hr_manager'
           when 'hr_manager' then 'tenant_admin'
         end;
$$;

comment on function private.exclusive_role(text) is
  'SECURITY-RELEVANT (BR-IAM-4). The role a person may not hold together with this one (null: none).';

-- Do the roles include both roles of an exclusive pair (an invitation's primary + additional roles)?
create or replace function private.roles_include_exclusive_pair(p_roles text[])
returns boolean
language sql immutable
set search_path = ''
as $$
  select exists (select 1 from unnest(p_roles) r where private.exclusive_role(r) = any (p_roles));
$$;

comment on function private.roles_include_exclusive_pair(text[]) is
  'SECURITY-RELEVANT (BR-IAM-4). True when the roles contain both roles of an exclusive pair.';

-- Do two validity windows overlap from now on? Null start/end = unbounded.
create or replace function private.role_windows_overlap(
  p_from_a timestamptz, p_until_a timestamptz, p_from_b timestamptz, p_until_b timestamptz)
returns boolean
language sql stable
set search_path = ''
as $$
  select greatest(pg_catalog.now(), coalesce(p_from_a, '-infinity'), coalesce(p_from_b, '-infinity'))
         < least(coalesce(p_until_a, 'infinity'), coalesce(p_until_b, 'infinity'));
$$;

comment on function private.role_windows_overlap(timestamptz, timestamptz, timestamptz, timestamptz) is
  'BR-IAM-4. Do two role validity windows overlap from now on (null = unbounded)?';

revoke all on function private.exclusive_role(text) from public;
revoke all on function private.roles_include_exclusive_pair(text[]) from public;
revoke all on function private.role_windows_overlap(timestamptz, timestamptz, timestamptz, timestamptz) from public;
-- The triggers below run as the writing role: the request path (authenticated, also under app_worker)
-- and invitation acceptance (invitation_guard).
grant execute on function private.exclusive_role(text) to authenticated, invitation_guard;
grant execute on function private.roles_include_exclusive_pair(text[]) to authenticated, invitation_guard;
grant execute on function private.role_windows_overlap(timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated, invitation_guard;

-- ---------------------------------------------------------------------------------------------------
-- Existing data (no silent changes: refuse with counts only)
-- ---------------------------------------------------------------------------------------------------
-- Counts of what breaks the rule, across every organization: members holding both roles of a pair (now
-- or later) and PENDING invitations giving both. For this migration and scripts/sql/verify-deployment.sql
-- (migration role only: it must bypass row-level security to see every organization, checked below).
create or replace function private.separation_of_duties_violations(out members bigint, out pending_invitations bigint)
language sql stable
set search_path = ''
as $$
  select
    (select count(distinct (a.tenant_id, a.membership_id))
     from platform.role_assignments a
     join platform.role_assignments b
       on b.tenant_id = a.tenant_id and b.membership_id = a.membership_id
      and b.role_code = private.exclusive_role(a.role_code)
     where private.role_windows_overlap(a.valid_from, a.valid_until, b.valid_from, b.valid_until)),
    (select count(*)
     from platform.invitations i
     where i.status = 'pending' and private.roles_include_exclusive_pair(array[i.primary_role] || i.additional_roles));
$$;

comment on function private.separation_of_duties_violations() is
  'BR-IAM-4. Members holding both roles of an exclusive pair and pending invitations giving both (counts). Migration role only.';

revoke all on function private.separation_of_duties_violations() from public;

do $$
declare
  v record;
begin
  -- Tenant tables force RLS: only a role that bypasses it sees every organization's rows.
  if not exists (select 1 from pg_catalog.pg_roles r where r.rolname = current_user and (r.rolsuper or r.rolbypassrls)) then
    raise exception 'role % must bypass row-level security to check existing role assignments (BR-IAM-4)', current_user;
  end if;
  select * into v from private.separation_of_duties_violations();
  if v.members > 0 or v.pending_invitations > 0 then
    raise exception 'separation of duties (BR-IAM-4): % member(s) hold both the Organization Admin and HR Manager roles and % pending invitation(s) would give both; resolve them first (docs/engineering/db-deploy.md, "Separation of duties (T-M2-16)")',
      v.members, v.pending_invitations
      using errcode = 'JR001';
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- platform.role_assignments
-- ---------------------------------------------------------------------------------------------------
create or replace function private.check_role_separation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_partner text := private.exclusive_role(new.role_code);
begin
  if v_partner is null then
    return new;
  end if;
  -- Serialised with every other role change of the organization (re-entrant: the actor guard took it
  -- already), then read what is committed (READ COMMITTED: a new snapshot for the query below).
  perform private.lock_tenant_roles(new.tenant_id);
  if exists (select 1 from platform.role_assignments ra
             where ra.tenant_id = new.tenant_id and ra.membership_id = new.membership_id
               and ra.role_code = v_partner
               and private.role_windows_overlap(ra.valid_from, ra.valid_until, new.valid_from, new.valid_until)) then
    raise exception 'the Organization Admin and HR Manager roles cannot be held by the same person (BR-IAM-4)'
      using errcode = 'JR001';
  end if;
  return new;
end
$$;

comment on function private.check_role_separation() is
  'SECURITY-RELEVANT (BR-IAM-4). Nobody holds the Organization Admin and HR Manager roles at the same time in one organization.';

revoke all on function private.check_role_separation() from public;

-- After role_assignments_guard (actor rules first: an unauthorised actor gets 42501), before
-- role_assignments_stamp_row (triggers of the same kind fire in name order).
create trigger role_assignments_separation_of_duties before insert or update on platform.role_assignments
  for each row execute function private.check_role_separation();

-- ---------------------------------------------------------------------------------------------------
-- platform.invitations
-- ---------------------------------------------------------------------------------------------------
create or replace function private.check_invitation_separation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.roles_include_exclusive_pair(array[new.primary_role] || new.additional_roles) then
    raise exception 'the Organization Admin and HR Manager roles cannot be given to the same person (BR-IAM-4)'
      using errcode = 'JR001';
  end if;
  return new;
end
$$;

comment on function private.check_invitation_separation() is
  'SECURITY-RELEVANT (BR-IAM-4). An invitation never gives both the Organization Admin and HR Manager roles.';

revoke all on function private.check_invitation_separation() from public;

-- After invitations_check (lifecycle and actor rules). Insert only: the roles of an invitation never change.
create trigger invitations_separation_of_duties before insert on platform.invitations
  for each row execute function private.check_invitation_separation();

-- ---------------------------------------------------------------------------------------------------
-- Invitation links: as in 20261009090000, plus the pair. Owner (invitation_guard), comment and grants
-- are kept by CREATE OR REPLACE; the migration role acts as the owner (as in that migration).
-- ---------------------------------------------------------------------------------------------------
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
  select ('tenant_admin' = any (i.codes)
          or ('hr_manager' = any (i.codes)
              and not exists (select 1 from platform.ref_roles r where r.code = any (p_roles) and r.is_privileged)))
         -- BR-IAM-4: nobody may give both roles of an exclusive pair (T-M2-16).
         and not private.roles_include_exclusive_pair(p_roles)
  from inviter i;
$$;

do $$
begin
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p
       where p.oid = 'private.invitation_inviter_may_grant(uuid, uuid, text[])'::regprocedure)) <> 'invitation_guard' then
    raise exception 'private.invitation_inviter_may_grant must stay owned by invitation_guard';
  end if;
end
$$;
