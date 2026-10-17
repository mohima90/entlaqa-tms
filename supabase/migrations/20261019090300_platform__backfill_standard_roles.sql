-- Data backfill for the six standard roles and one role per person (EP-ROLES, FR-IAM-07/08; PO 17 Oct 2026;
-- mapping: docs/delivery/roles/README.md §4). Separate from the schema changes (conventions §2). Runs as a
-- platform operation (no user claims). The counts are printed as WARNINGs so that DB deploy's plan (a
-- rolled-back dry run) shows them before anything is applied.
--
-- 1. Role assignments — one per membership, mapped:
--      keep ONE row per membership: a role that continues before one that ends, then the role in force (an
--      expired or scheduled Organization Admin row never wins over a role the person holds now — review L6;
--      an Organization Admin in force always stays, so no organization loses its admin), then the
--      Organization Admin row, the primary role, the oldest; delete the others;
--      former roles of the kept row map to Employee (learner) — Line Manager, Internal Instructor, Finance
--      Manager, Compliance Officer, Auditor, Mentor — or end (External Instructor, Training Provider Admin:
--      non-employee users are R2, FR-IAM-15). Nobody gains a permission: a kept standard role is one the
--      person already held, and Employee grants only "view own record" (which My profile always gave);
--      members who lose permissions are counted so the Organization Admin can rebuild the access with a
--      custom role or a template.
-- 2. Pending invitations — the same mapping for the role they give; additional roles dropped; an invitation
--    whose role ends is revoked. (The lifecycle trigger forbids changing what an invitation gives; it is
--    disabled for these updates only, inside this transaction.)
-- 3. Security policies — former roles leave the "roles that must use an authenticator app" lists. User
--    imports not finished — a former default role becomes Employee, and so do former roles in the rows
--    still to be added (review L6).
-- Every member whose roles change gets an audit event (platform.user.roles_changed, actor: none — this
-- migration; before/after role codes), review L6.
-- 4. The eight former roles leave platform.ref_roles: nobody can be given them any more (their codes stay
--    in history: audit events, accepted and revoked invitations).

-- The row each membership keeps (a function rather than a temporary table: migrations create no
-- temporary objects). Dropped at the end of this migration.
create function private.ep_roles_kept_assignments()
returns table (id uuid)
language sql stable
set search_path = ''
as $$
  select distinct on (ra.tenant_id, ra.membership_id) ra.id
  from platform.role_assignments ra
  order by ra.tenant_id, ra.membership_id,
           (ra.role_code in ('external_instructor', 'provider_admin')),  -- a role that continues before one that ends
           ((ra.valid_from is null or ra.valid_from <= now()) and (ra.valid_until is null or ra.valid_until > now())) desc,
           (ra.role_code = 'tenant_admin') desc,
           ra.is_primary desc,
           ra.created_at, ra.id;
$$;

do $$
declare
  c_former constant text[] := array['line_manager', 'internal_instructor', 'finance_manager', 'compliance_officer',
                                    'auditor', 'mentor', 'external_instructor', 'provider_admin'];
  c_ended constant text[] := array['external_instructor', 'provider_admin'];
  v_extra bigint;
  v_mapped bigint;
  v_ended bigint;
  v_losing bigint;
  v_inv_mapped bigint;
  v_inv_extra bigint;
  v_inv_revoked bigint;
  v_policies bigint;
  v_audited bigint;
  v_imports bigint;
  v_import_rows bigint;
  r record;
begin
  -- Audit first (review L6): one event per member whose roles change — before: every role code held;
  -- after: the role kept, mapped (or none when it ends).
  insert into platform.audit_events (tenant_id, action, entity_type, entity_id, data)
  select x.tenant_id, 'platform.user.roles_changed', 'person', m.person_id::text,
         jsonb_build_object('before', to_jsonb(x.before_codes), 'after', x.after_code,
                            'reason', 'EP-ROLES role mapping (migration 20261019090300)')
  from (
    select ra.tenant_id, ra.membership_id, array_agg(ra.role_code order by ra.role_code) as before_codes,
           (select case when k.role_code = any (c_ended) then null
                        when k.role_code = any (c_former) then 'learner'
                        else k.role_code end
            from platform.role_assignments k
            where k.membership_id = ra.membership_id and k.id in (select e.id from private.ep_roles_kept_assignments() e)) as after_code
    from platform.role_assignments ra
    group by ra.tenant_id, ra.membership_id
  ) x
  join platform.tenant_memberships m on m.tenant_id = x.tenant_id and m.id = x.membership_id
  where x.before_codes is distinct from array[x.after_code];
  get diagnostics v_audited = row_count;

  -- Who loses permissions (counted before anything changes): members with more than one role, or with a
  -- former role that granted more than Employee does.
  select count(distinct ra.membership_id) into v_losing
  from platform.role_assignments ra
  where ra.membership_id in (select membership_id from platform.role_assignments
                             group by membership_id having count(*) > 1)
     or ra.role_code = any (array['finance_manager', 'compliance_officer', 'auditor', 'line_manager']);

  for r in
    select ra.role_code, count(*) as n from platform.role_assignments ra
    where ra.id not in (select k.id from private.ep_roles_kept_assignments() k)
    group by ra.role_code order by ra.role_code
  loop
    raise warning 'EP-ROLES: extra role % removed from % member(s) (one role per person)', r.role_code, r.n;
  end loop;
  delete from platform.role_assignments ra
  where ra.id not in (select k.id from private.ep_roles_kept_assignments() k);
  get diagnostics v_extra = row_count;

  for r in
    select ra.role_code, count(*) as n from platform.role_assignments ra
    where ra.role_code = any (c_former) group by ra.role_code order by ra.role_code
  loop
    raise warning 'EP-ROLES: % member(s) with former role % → %', r.n, r.role_code,
      case when r.role_code = any (c_ended) then 'role ended' else 'Employee (learner)' end;
  end loop;
  delete from platform.role_assignments ra where ra.role_code = any (c_ended);
  get diagnostics v_ended = row_count;
  update platform.role_assignments ra set role_code = 'learner', is_primary = true
  where ra.role_code = any (c_former);
  get diagnostics v_mapped = row_count;
  update platform.role_assignments ra set is_primary = true where not ra.is_primary;

  -- 2. Pending invitations.
  alter table platform.invitations disable trigger invitations_check;
  for r in
    select i.primary_role, count(*) as n from platform.invitations i
    where i.status = 'pending' and i.primary_role = any (c_former) group by i.primary_role order by i.primary_role
  loop
    raise warning 'EP-ROLES: % pending invitation(s) with former role % → %', r.n, r.primary_role,
      case when r.primary_role = any (c_ended) then 'revoked' else 'Employee (learner)' end;
  end loop;
  update platform.invitations i
  set status = 'revoked', revoked_at = now(), invite_code = null, send_at = null, additional_roles = '{}'
  where i.status = 'pending' and i.primary_role = any (c_ended);
  get diagnostics v_inv_revoked = row_count;
  update platform.invitations i set primary_role = 'learner'
  where i.status = 'pending' and i.primary_role = any (c_former);
  get diagnostics v_inv_mapped = row_count;
  update platform.invitations i set additional_roles = '{}'
  where i.status = 'pending' and cardinality(i.additional_roles) > 0;
  get diagnostics v_inv_extra = row_count;
  alter table platform.invitations enable trigger invitations_check;

  -- 3. Security policies (without the "policy changed" e-mail to the admins: nothing they chose changes).
  alter table platform.security_policies disable trigger security_policies_changed_mail;
  update platform.security_policies s
  set mfa_required_roles = array(select x from unnest(s.mfa_required_roles) x where not (x = any (c_former)))
  where s.mfa_required_roles && c_former;
  get diagnostics v_policies = row_count;
  alter table platform.security_policies enable trigger security_policies_changed_mail;

  -- 3b. User imports not finished: the default role and the rows still to be added (review L6). The
  -- import's lifecycle trigger does not watch options changes by a platform operation; disabled anyway for
  -- these updates only, inside this transaction.
  alter table platform.user_imports disable trigger user_imports_check;
  update platform.user_imports i
  set options = jsonb_set(i.options, '{defaultRole}', '"learner"')
  where i.options ->> 'defaultRole' = any (c_former)
    and i.status not in ('finished', 'rejected', 'stopped', 'undone', 'failed', 'expired', 'cancelled');
  get diagnostics v_imports = row_count;
  alter table platform.user_imports enable trigger user_imports_check;
  update platform.user_import_rows x
  set data = jsonb_set(x.data, '{primary_role}', '"learner"')
  where x.result is null and x.data ->> 'primary_role' = any (c_former);
  get diagnostics v_import_rows = row_count;

  -- 4. The former roles.
  delete from platform.ref_roles where code = any (c_former);

  raise warning 'EP-ROLES role mapping: % extra role(s) removed, % former role(s) mapped to Employee, % ended; % member(s) lose permissions (rebuild with a custom role); invitations: % mapped, % with additional roles cleared, % revoked; % security polic(ies) updated; imports: % default role(s) and % row(s) mapped; % audit event(s)',
    v_extra, v_mapped, v_ended, v_losing, v_inv_mapped, v_inv_extra, v_inv_revoked, v_policies, v_imports,
    v_import_rows, v_audited;
end
$$;

drop function private.ep_roles_kept_assignments();
