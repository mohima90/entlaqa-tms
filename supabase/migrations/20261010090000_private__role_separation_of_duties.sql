-- Separation of duties (BR-IAM-4, FR-IAM-07, T-M2-16; PO decisions 7 and 8 Oct 2026, BRD v2.6): the
-- Organization Admin (tenant_admin) is a setup-only role and holds NO other role. A member who holds
-- tenant_admin cannot hold any other role (learner, HR Manager, anything) at the same time, and a member
-- who holds any role cannot be given tenant_admin; an invitation never gives tenant_admin together with
-- another role. Roles other than tenant_admin combine freely. The rule is per organization: a person is
-- a tenant-scoped record, and a login has at most one membership per organization (tenant_memberships
-- unique (tenant_id, user_id) and (tenant_id, person_id)), so "the same person" = the same membership.
-- The same login may be the Organization Admin of one organization and hold other roles in another.
--
-- "Holds" follows the validity windows of role_assignments: two rows conflict when their windows
-- overlap from now on — [greatest(now, both starts), least(both ends)) is not empty (open start/end =
-- unbounded). A role that has already ended is history and conflicts with nothing; a hand-over can be
-- scheduled (Organization Admin until 31 Oct, other roles from 1 Nov). As time passes a conflict can only
-- disappear, never appear, so checking every write is enough.
--
-- Where it is enforced (defence in depth; the application checks first and maps the refusal):
--   platform.role_assignments  trigger role_assignments_separation_of_duties (BEFORE INSERT OR UPDATE, every
--                              writer: request path, system jobs, invitation acceptance, platform
--                              operations — provisioning included). Race-safe: it takes the per-tenant
--                              role lock (private.lock_tenant_roles, the same advisory lock every role and
--                              membership change takes — READ COMMITTED only) before reading the other
--                              rows, so of two concurrent transactions each adding a conflicting role the
--                              second waits for the first to commit, then sees its row and is refused.
--                              Rows written earlier by the same statement are visible to the check too
--                              (multi-row INSERT / UPDATE).
--   platform.invitations       trigger invitations_separation_of_duties (BEFORE INSERT, every writer): an
--                              invitation's roles never change after insert (check_invitation).
--   invitation links           private.invitation_inviter_may_grant (owner invitation_guard) also answers
--                              no for such roles: the link reads as invalid, the sign-up gate refuses it
--                              and acceptance fails with JI001. (An invitation is accepted only by a
--                              person without a membership, so acceptance cannot combine with existing
--                              roles; acceptance gives exactly the invitation's roles, no implicit one;
--                              the role trigger above refuses a conflict anyway.)
--
-- Error: SQLSTATE JR001 (→ @jadarat/platform-db: role change refusal `role_conflict`, invitation
-- DomainError ROLE_CONFLICT). The message names the rule only (no ids, no personal data).
--
-- Existing data: the migration refuses to run while any membership already holds tenant_admin together
-- with another role (overlapping windows) or any PENDING invitation would give tenant_admin with another
-- role. Nothing is changed or deleted silently: the error gives the counts only; see
-- docs/engineering/db-deploy.md § "Separation of duties (T-M2-16)" for what to do.
-- scripts/sql/verify-deployment.sql checks the same invariant after every deploy.
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
-- May one person not hold these two roles at the same time? The one place that states the rule:
-- tenant_admin conflicts with every other role. packages/platform-rbac separation-of-duties.ts
-- (SOLE_ROLE_CODES) mirrors it (drift test in separation-of-duties.test.ts).
create or replace function private.roles_conflict(p_role_a text, p_role_b text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_role_a is distinct from p_role_b and 'tenant_admin' in (p_role_a, p_role_b);
$$;

comment on function private.roles_conflict(text, text) is
  'SECURITY-RELEVANT (BR-IAM-4). True when one person may not hold both roles at the same time (tenant_admin holds no other role).';

-- Do the roles (an invitation's primary + additional roles) include two that conflict?
create or replace function private.roles_include_conflict(p_roles text[])
returns boolean
language sql immutable
set search_path = ''
as $$
  select exists (select 1 from unnest(p_roles) a, unnest(p_roles) b where private.roles_conflict(a, b));
$$;

comment on function private.roles_include_conflict(text[]) is
  'SECURITY-RELEVANT (BR-IAM-4). True when the roles contain two roles one person may not hold together.';

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

revoke all on function private.roles_conflict(text, text) from public;
revoke all on function private.roles_include_conflict(text[]) from public;
revoke all on function private.role_windows_overlap(timestamptz, timestamptz, timestamptz, timestamptz) from public;
-- The triggers below run as the writing role: the request path (authenticated, also under app_worker)
-- and invitation acceptance (invitation_guard).
grant execute on function private.roles_conflict(text, text) to authenticated, invitation_guard;
grant execute on function private.roles_include_conflict(text[]) to authenticated, invitation_guard;
grant execute on function private.role_windows_overlap(timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated, invitation_guard;

-- ---------------------------------------------------------------------------------------------------
-- Existing data (no silent changes: refuse with counts only)
-- ---------------------------------------------------------------------------------------------------
-- Counts of what breaks the rule, across every organization: members holding two conflicting roles (now
-- or later) and PENDING invitations giving them. For this migration and scripts/sql/verify-deployment.sql
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
     where private.roles_conflict(a.role_code, b.role_code)
       and private.role_windows_overlap(a.valid_from, a.valid_until, b.valid_from, b.valid_until)),
    (select count(*)
     from platform.invitations i
     where i.status = 'pending' and private.roles_include_conflict(array[i.primary_role] || i.additional_roles));
$$;

comment on function private.separation_of_duties_violations() is
  'BR-IAM-4. Members holding conflicting roles and pending invitations giving them (counts). Migration role only.';

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
    raise exception 'separation of duties (BR-IAM-4): % member(s) hold the Organization Admin role together with another role and % pending invitation(s) would give it with another role; resolve them first (docs/engineering/db-deploy.md, "Separation of duties (T-M2-16)")',
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
begin
  -- Serialised with every other role change of the organization (re-entrant: the actor guard took it
  -- already), then read what is committed (READ COMMITTED: a new snapshot for the query below).
  perform private.lock_tenant_roles(new.tenant_id);
  if exists (select 1 from platform.role_assignments ra
             where ra.tenant_id = new.tenant_id and ra.membership_id = new.membership_id
               and private.roles_conflict(ra.role_code, new.role_code)
               and private.role_windows_overlap(ra.valid_from, ra.valid_until, new.valid_from, new.valid_until)) then
    raise exception 'the Organization Admin role cannot be held together with another role (BR-IAM-4)'
      using errcode = 'JR001';
  end if;
  return new;
end
$$;

comment on function private.check_role_separation() is
  'SECURITY-RELEVANT (BR-IAM-4). Nobody holds the Organization Admin role together with another role in one organization.';

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
  if private.roles_include_conflict(array[new.primary_role] || new.additional_roles) then
    raise exception 'the Organization Admin role cannot be given together with another role (BR-IAM-4)'
      using errcode = 'JR001';
  end if;
  return new;
end
$$;

comment on function private.check_invitation_separation() is
  'SECURITY-RELEVANT (BR-IAM-4). An invitation never gives the Organization Admin role together with another role.';

revoke all on function private.check_invitation_separation() from public;

-- After invitations_check (lifecycle and actor rules). Insert only: the roles of an invitation never change.
create trigger invitations_separation_of_duties before insert on platform.invitations
  for each row execute function private.check_invitation_separation();

-- ---------------------------------------------------------------------------------------------------
-- Invitation links: as in 20261009090000, plus the rule. Owner (invitation_guard), comment and grants
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
         -- BR-IAM-4: nobody may give the Organization Admin role with another role (T-M2-16).
         and not private.roles_include_conflict(p_roles)
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
